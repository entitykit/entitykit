import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import type { MigrationBuilder } from '../packages/core/src/migrations/api';
import { contextMigrations, Migration } from '../packages/core/src/migrations/api';
import { createFakeProvider, fakeMigrationDialect, fakeSqlDialect } from './support/fake-provider';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class FakeUser {
    public id!: string;
    public email!: string;
    constructor(data?: Partial<FakeUser>) {
        Object.assign(this, data);
    }
}

class CreateFakeUsers extends Migration {
    public readonly id = '20260601120000_CreateFakeUsers';
    public readonly name = 'CreateFakeUsers';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('fake_users', [
            { name: 'id', type: 'text', primaryKey: true },
            { name: 'email', type: 'text' },
        ]);
    }
}

class FakeProviderContext extends DbContext {
    public users = this.set(FakeUser);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(createFakeProvider(), {
            connectionString: 'fake://unit-test',
            connection: this.connection,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(FakeUser, entity => {
            entity.toTable('fake_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        });
    }

    public static createWith(connection: RecordingDatabaseConnection): FakeProviderContext {
        const context = FakeProviderContext.create(connection);
        return context;
    }
}

describe('fake provider seam fixture', () => {
    it('runs core query and save paths through non-Postgres provider services', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  FakeProviderContext.createWith(connection);
        const user = new FakeUser({ id: 'usr_1', email: 'a@example.com' });
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });

        expect(contextOptions(db).provider).toEqual({ provider: 'fake-provider' });
        expect(contextOptions(db).dialect).toBe(fakeSqlDialect);
        expect(contextOptions(db).migrationDialect).toBe(fakeMigrationDialect);
        expect(db.users.where(row => row.email.eq('a@example.com')).toSql()).toEqual({
            text: 'select `id`, `email` from `fake_users` where `email` = ?',
            values: ['a@example.com'],
        });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements).toEqual([
            {
                text: 'insert into `fake_users` (`id`, `email`) values (?, ?)',
                values: ['usr_1', 'a@example.com'],
            },
        ]);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('runs migration updates through the fake migration dialect without advisory locks', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  FakeProviderContext.createWith(connection);
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult();
        connection.queueResult({ rowCount: 1 });

        const result = await contextMigrations(db).update([new CreateFakeUsers()]);

        expect(result).toEqual({
            appliedMigrations: ['up:20260601120000_CreateFakeUsers'],
            usedMigrationLock: false,
            transactionSuppressedStatements: 0,
        });
        expect(connection.sessionEvents).toEqual(['start', 'end']);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'create table if not exists `entitykit_migrations` (`id` text primary key, `name` text not null, `checksum` text not null, `entitykit_version` text not null)',
            'create table if not exists `entitykit_migrations` (`id` text primary key, `name` text not null, `checksum` text not null, `entitykit_version` text not null)',
            'select `id`, `name`, `checksum`, `entitykit_version` from `entitykit_migrations` order by `id`',
            'create table if not exists `fake_users` (`id` text primary key, `email` text not null)',
            'insert into `entitykit_migrations` (`id`, `name`, `checksum`, `entitykit_version`) values (?, ?, ?, ?)',
        ]);
        expect(connection.statements.map(statement => statement.text).join('\n')).not.toContain('pg_advisory');
    });

    it('makes db-pull availability explicit through optional schema introspection', () => {
        expect(typeof createFakeProvider().createSchemaIntrospector).toBe('undefined');

        const provider = createFakeProvider({
            introspector: {
                async introspect() {
                    return Promise.resolve({
                        schemas: [{ name: 'fake', tables: [] }],
                    });
                },
            },
        });

        expect(provider.createSchemaIntrospector?.(new RecordingDatabaseConnection())).toBeDefined();
    });
});
import { contextOptions } from './support/public-api-internals';
