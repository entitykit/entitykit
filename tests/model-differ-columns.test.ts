import { diffModelSnapshots, MigrationSqlGenerator } from '../packages/core/src/migrations/api';
import {
    accountsSnapshot,
    emptySnapshot,
    usersSnapshot,
    usersWithChangedEmailSnapshot,
    usersWithNameSnapshot,
    usersWithRenamedEmailColumnSnapshot,
} from './model-differ-support';

describe('model snapshot column and rename differ', () => {
    it('creates table and index operations for new entities', () => {
        const diff = diffModelSnapshots(emptySnapshot, usersSnapshot);

        expect(diff.hasChanges).toBe(true);
        expect(diff.operations).toMatchObject([
            { kind: 'createTable', tableName: 'users', schemaName: 'app' },
            { kind: 'createIndex', name: 'ux_users_email', columns: ['email'], unique: true },
        ]);

        const script = new MigrationSqlGenerator().generateUpScript(diff.toMigration('20260601130000_CreateUsers', 'CreateUsers'));

        expect(script).toContain('create schema if not exists "app";');
        expect(script).toContain('create table if not exists "app"."users" ("id" uuid primary key, "email" varchar(255) not null);');
        expect(script).toContain('create unique index if not exists "ux_users_email" on "app"."users" ("email");');
    });

    it('detects added columns', () => {
        const diff = diffModelSnapshots(usersSnapshot, usersWithNameSnapshot);

        expect(diff.operations).toEqual([
            {
                kind: 'addColumn',
                entityName: 'User',
                tableName: 'users',
                schemaName: 'app',
                column: { name: 'name', type: 'text', nullable: true, primaryKey: false, defaultSql: undefined },
            },
        ]);
    });

    it('detects changed column definitions', () => {
        const diff = diffModelSnapshots(usersSnapshot, usersWithChangedEmailSnapshot);

        expect(diff.operations).toEqual([
            {
                kind: 'alterColumn',
                entityName: 'User',
                tableName: 'users',
                schemaName: 'app',
                column: {
                    name: 'email',
                    type: 'varchar(320)',
                    nullable: true,
                    primaryKey: false,
                    defaultSql: '\'unknown@example.com\'',
                    oldType: 'varchar(255)',
                    oldNullable: false,
                    oldDefaultSql: undefined,
                },
            },
        ]);

        const script = new MigrationSqlGenerator().generateUpScript(diff.toMigration('20260601150000_AlterUsers', 'AlterUsers'));

        expect(script).toContain('alter table "app"."users" alter column "email" type varchar(320);');
        expect(script).toContain('alter table "app"."users" alter column "email" drop not null;');
        expect(script).toContain('alter table "app"."users" alter column "email" set default \'unknown@example.com\';');
    });

    it('uses column rename hints to preserve data', () => {
        const diff = diffModelSnapshots(usersSnapshot, usersWithRenamedEmailColumnSnapshot, {
            renameHints: {
                columns: [{ schemaName: 'app', tableName: 'users', from: 'email', to: 'contact_email' }],
            },
        });

        expect(diff.operations).toEqual([
            {
                kind: 'alterColumn',
                entityName: 'User',
                tableName: 'users',
                schemaName: 'app',
                column: {
                    name: 'contact_email',
                    type: 'varchar(255)',
                    nullable: false,
                    primaryKey: false,
                    defaultSql: undefined,
                    oldName: 'email',
                    oldType: 'varchar(255)',
                    oldNullable: false,
                    oldDefaultSql: undefined,
                },
            },
        ]);

        const migration = diff.toMigration('20260601151000_RenameEmail', 'RenameEmail');
        const up = new MigrationSqlGenerator().generateUpScript(migration);
        const down = new MigrationSqlGenerator().generateDownScript(migration);

        expect(up).toContain('alter table "app"."users" rename column "email" to "contact_email";');
        expect(down).toContain('alter table "app"."users" rename column "contact_email" to "email";');
    });

    it('uses table rename hints to preserve data', () => {
        const diff = diffModelSnapshots(usersSnapshot, accountsSnapshot, {
            renameHints: {
                tables: [{ schemaName: 'app', from: 'users', to: 'accounts' }],
            },
        });

        expect(diff.operations).toMatchObject([
            { kind: 'renameTable', tableName: 'users', newTableName: 'accounts', schemaName: 'app' },
        ]);
        expect(diff.operations.some(operation => operation.kind === 'dropTable' || operation.kind === 'createTable')).toBe(false);

        const migration = diff.toMigration('20260601152000_RenameUsers', 'RenameUsers');
        const up = new MigrationSqlGenerator().generateUpScript(migration);
        const down = new MigrationSqlGenerator().generateDownScript(migration);

        expect(up).toContain('alter table "app"."users" rename to "accounts";');
        expect(down).toContain('alter table "app"."accounts" rename to "users";');
    });

});
