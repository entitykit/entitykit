import fs from 'fs';
import path from 'path';
import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import {
    DbContext,
} from '../src';
import {
    contextMigrations,
    renderSnapshotSource,
    scaffoldMigration,
    writeMigrationScaffold,
    readModelSnapshot,
} from '../src/migrations/api';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { createManagedTempDirectory } from './support/managed-temp-directory';

class Role {
    public id!: string;
    public users!: User[];
}

class User {
    public id!: string;
    public email!: string;
    public roles!: Role[];
    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class UserContext extends DbContext {
    public users = this.set(User);
    public static connection = new RecordingDatabaseConnection();

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(UserContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users', 'app');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired().isUnique();
        });
    }
}

class ChangedUserContext extends DbContext {
    public users = this.set(User);
    public static connection = new RecordingDatabaseConnection();

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(ChangedUserContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users', 'app');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('varchar').hasMaxLength(320).isOptional().hasDefaultValue('unknown@example.com');
        });
    }
}

class UserRolesContext extends DbContext {
    public users = this.set(User);
    public roles = this.set(Role);
    public static connection = new RecordingDatabaseConnection();

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(UserRolesContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users', 'app');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired().isUnique();
            entity.hasManyToMany(Role, user => user.roles)
                .withMany(role => role.users)
                .usingJoinTable('user_roles', join => {
                    join.hasSchema('app');
                    join.sourceForeignKey('user_id');
                    join.targetForeignKey('role_id');
                    join.sourceConstraintName('fk_user_roles_users_user_id');
                    join.targetConstraintName('fk_user_roles_roles_role_id');
                });
        });

        model.entity(Role, entity => {
            entity.toTable('roles', 'app');
            entity.hasKey(role => role.id);
            entity.property(role => role.id).hasColumnName('id').hasColumnType('uuid').isRequired();
        });
    }
}

function tempDir(): string {
    return createManagedTempDirectory('entitykit-scaffold-');
}

describe('migration scaffolder', () => {
    it('generates migration and snapshot sources from model diffs', () => {
        const db =  UserContext.create();
        const dir = tempDir();
        const result = scaffoldMigration(contextMigrations(db), {
            name: 'Initial Create',
            migrationsDir: dir,
            snapshotPath: path.join(dir, 'EntityKitModelSnapshot.ts'),
            now: new Date('2026-06-01T18:45:30Z'),
        });

        expect(result.id).toBe('20260601184530_InitialCreate');
        expect(result.hasChanges).toBe(true);
        expect(result.migrationSource).toContain(
            'import { Migration, MigrationBuilder, type ModelSnapshot } from "entitykit/migrations";',
        );
        expect(result.migrationSource).toContain('export default class InitialCreate extends Migration');
        expect(result.migrationSource).toContain('builder.createSchema("app");');
        expect(result.migrationSource).toContain('builder.createTable("users"');
        expect(result.snapshotSource).toContain('import type { ModelSnapshot } from "entitykit/migrations";');
        expect(result.snapshotSource).toContain('"tableName": "users"');
    });

    it('writes migration and snapshot files', () => {
        const db =  UserContext.create();
        const dir = tempDir();
        const snapshotPath = path.join(dir, 'EntityKitModelSnapshot.ts');
        const result = scaffoldMigration(contextMigrations(db), {
            name: 'Initial Create',
            migrationsDir: dir,
            snapshotPath,
            now: new Date('2026-06-01T18:45:30Z'),
        });

        writeMigrationScaffold(result);

        expect(fs.existsSync(path.join(dir, '20260601184530_InitialCreate.ts'))).toBe(true);
        expect(readModelSnapshot(snapshotPath)?.entities[0]?.tableName).toBe('users');
    });

    it('refuses to overwrite an existing timestamped migration file', () => {
        const db =  UserContext.create();
        const dir = tempDir();
        const snapshotPath = path.join(dir, 'EntityKitModelSnapshot.ts');
        const result = scaffoldMigration(contextMigrations(db), {
            name: 'Initial Create',
            migrationsDir: dir,
            snapshotPath,
            now: new Date('2026-06-01T18:45:30Z'),
        });
        fs.writeFileSync(result.migrationPath, 'manual migration edits', 'utf8');

        expect(() => {
            writeMigrationScaffold(result);
        }).toThrow('Migration file already exists');

        expect(fs.readFileSync(result.migrationPath, 'utf8')).toBe('manual migration edits');
        expect(fs.existsSync(snapshotPath)).toBe(false);
    });

    it('removes the migration file when snapshot writing fails', () => {
        const db =  UserContext.create();
        const dir = tempDir();
        const result = scaffoldMigration(contextMigrations(db), {
            name: 'Initial Create',
            migrationsDir: path.join(dir, 'migrations'),
            snapshotPath: path.join(dir, 'EntityKitModelSnapshot.ts'),
            now: new Date('2026-06-01T18:45:30Z'),
        });
        const snapshotPath = path.join(dir, 'snapshot-directory');
        fs.mkdirSync(snapshotPath);
        const failingResult = { ...result, snapshotPath };

        expect(() => {
            writeMigrationScaffold(failingResult);
        }).toThrow('Existing files were restored');

        expect(fs.existsSync(result.migrationPath)).toBe(false);
        expect(fs.existsSync(path.join(dir, 'migrations'))).toBe(false);
    });

    it('warns about destructive table and column drops', () => {
        const db =  UserContext.create();
        const dir = tempDir();
        const snapshotPath = path.join(dir, 'EntityKitModelSnapshot.ts');
        fs.writeFileSync(snapshotPath, [
            'import type { ModelSnapshot } from "entitykit";',
            '',
            'export default {"formatVersion":1,"entities":[{"entityName":"Old","tableName":"old_users","keyProperty":"id","properties":[{"propertyName":"id","columnName":"id","columnType":"uuid","isRequired":true,"isPrimaryKey":true,"isUnique":false,"hasConverter":false,"isConcurrencyToken":false,"isVersion":false}],"ignoredProperties":[],"indexes":[],"relationships":[]}]} satisfies ModelSnapshot;',
        ].join('\n'));

        const result = scaffoldMigration(contextMigrations(db), {
            name: 'Drop Old',
            migrationsDir: dir,
            snapshotPath,
            now: new Date('2026-06-01T18:45:30Z'),
        });

        expect(result.warnings).toContain('Drop table old_users');
        expect(result.migrationSource).toContain('WARNING: This operation may cause data loss.');
    });

    it('renders altered column definitions in generated migration sources', () => {
        const previousDb =  UserContext.create();
        const previousSnapshot = contextMigrations(previousDb).createModelSnapshot();
        const db =  ChangedUserContext.create();
        const dir = tempDir();
        const snapshotPath = path.join(dir, 'EntityKitModelSnapshot.ts');
        fs.writeFileSync(snapshotPath, renderSnapshotSource(previousSnapshot));

        const result = scaffoldMigration(contextMigrations(db), {
            name: 'Alter Email',
            migrationsDir: dir,
            snapshotPath,
            now: new Date('2026-06-01T18:45:30Z'),
        });

        expect(result.operations).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'alterColumn', tableName: 'users', schemaName: 'app' }),
        ]));
        expect(result.warnings).toEqual(expect.arrayContaining([
            'Alter column app.users.email type text -> varchar(320)',
            'Alter column app.users.email nullability not null -> nullable',
            'Alter column app.users.email default no default -> \'unknown@example.com\'',
        ]));
        expect(result.migrationSource).toContain('builder.alterColumn("users"');
        expect(result.migrationSource).toContain('"type": "varchar(320)"');
        expect(result.migrationSource).toContain('"oldType": "text"');
        expect(result.migrationSource).toContain('"defaultSql": "\'unknown@example.com\'"');
        expect(result.migrationSource).toContain('// - Alter column app.users.email type text -> varchar(320)');
    });

    it('renders many-to-many join table operations in generated migration sources', () => {
        const previousDb =  UserContext.create();
        const previousSnapshot = contextMigrations(previousDb).createModelSnapshot();
        const db =  UserRolesContext.create();
        const dir = tempDir();
        const snapshotPath = path.join(dir, 'EntityKitModelSnapshot.ts');
        fs.writeFileSync(snapshotPath, renderSnapshotSource(previousSnapshot));

        const result = scaffoldMigration(contextMigrations(db), {
            name: 'Add User Roles',
            migrationsDir: dir,
            snapshotPath,
            now: new Date('2026-06-01T18:45:30Z'),
        });

        expect(result.operations).toMatchObject([
            { kind: 'createTable', tableName: 'roles', schemaName: 'app' },
            { kind: 'createJoinTable', tableName: 'user_roles', schemaName: 'app' },
        ]);
        expect(result.migrationSource).toContain('builder.createTable("user_roles"');
        expect(result.migrationSource).toContain('"primaryKeyName": "pk_user_roles"');
        expect(result.migrationSource).toContain('"name": "fk_user_roles_users_user_id"');
        expect(result.migrationSource).toContain('"name": "fk_user_roles_roles_role_id"');
    });

    it('warns about destructive many-to-many join table drops', () => {
        const previousDb =  UserRolesContext.create();
        const previousSnapshot = contextMigrations(previousDb).createModelSnapshot();
        const db =  UserContext.create();
        const dir = tempDir();
        const snapshotPath = path.join(dir, 'EntityKitModelSnapshot.ts');
        fs.writeFileSync(snapshotPath, renderSnapshotSource(previousSnapshot));

        const result = scaffoldMigration(contextMigrations(db), {
            name: 'Drop User Roles',
            migrationsDir: dir,
            snapshotPath,
            now: new Date('2026-06-01T18:45:30Z'),
        });

        expect(result.warnings).toContain('Drop join table app.user_roles');
        expect(result.migrationSource).toContain('builder.dropTable("user_roles", "app");');
    });
});
