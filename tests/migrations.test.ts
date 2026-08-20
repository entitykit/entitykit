import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../packages/core/src';
import {
    DbContext,
} from '../packages/core/src';
import type {
    MigrationBuilder } from '../packages/core/src/migrations/api';
import {
    Migration,
    contextMigrations,
    MigrationRunner,
    MigrationSqlGenerator,
} from '../packages/core/src/migrations/api';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class CreateUsersMigration extends Migration {
    public readonly id = '20260601120000_CreateUsers';
    public readonly name = 'CreateUsers';

    public override up(builder: MigrationBuilder): void {
        builder.createSchema('app');
        builder.createTable('users', [
            { name: 'id', type: 'uuid', primaryKey: true },
            { name: 'email', type: 'text', nullable: false },
            { name: 'created_at', type: 'timestamptz', nullable: false, defaultSql: 'now()' },
        ], 'app');
        builder.createIndex({ name: 'ux_users_email', tableName: 'users', schemaName: 'app', columns: ['email'], unique: true });
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropIndex('ux_users_email', 'app');
        builder.dropTable('users', 'app');
    }
}

class EmptyContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(EmptyContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        void model;
    }
}

function createDb(connection: RecordingDatabaseConnection): EmptyContext {
    EmptyContext.connection = connection;
    return EmptyContext.create();
}

describe('migrations groundwork', () => {
    it('generates reviewable SQL scripts with migration history', () => {
        const script = new MigrationSqlGenerator().generateUpScript(new CreateUsersMigration());

        expect(script).toContain('create table if not exists "__entitykit_migrations"');
        expect(script).toContain('create schema if not exists "app";');
        expect(script).toContain('create table if not exists "app"."users" ("id" uuid primary key, "email" text not null, "created_at" timestamptz not null default now());');
        expect(script).toContain('create unique index if not exists "ux_users_email" on "app"."users" ("email");');
        expect(script).toContain('insert into "__entitykit_migrations" ("id", "name", "checksum", "entitykit_version") values (\'20260601120000_CreateUsers\', \'CreateUsers\'');
    });

    it('runs migration statements inside a transaction', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult(); // acquire lock
        connection.queueResult({ rowCount: 0 });
        connection.queueResult({ rowCount: 0 });
        connection.queueResult({ rowCount: 0 });
        connection.queueResult({ rowCount: 0 });
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await new MigrationRunner(connection).apply(new CreateUsersMigration());

        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'select pg_advisory_lock(hashtext($1))',
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'create schema if not exists "app"',
            'create table if not exists "app"."users" ("id" uuid primary key, "email" text not null, "created_at" timestamptz not null default now())',
            'create unique index if not exists "ux_users_email" on "app"."users" ("email")',
            'insert into "__entitykit_migrations" ("id", "name", "checksum", "entitykit_version") values ($1, $2, $3, $4)',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
        expect(connection.statements[5]?.values.slice(0, 2)).toEqual(['20260601120000_CreateUsers', 'CreateUsers']);
        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });

    it('holds the migration lock while directly reverting', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult(); // acquire lock
        connection.queueResult(); // drop index
        connection.queueResult(); // drop table
        connection.queueResult({ rowCount: 1 }); // delete history
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await new MigrationRunner(connection).revert(new CreateUsersMigration());

        expect(connection.statements.map(statement => statement.text)).toEqual([
            'select pg_advisory_lock(hashtext($1))',
            'drop index if exists "app"."ux_users_email"',
            'drop table if exists "app"."users"',
            'delete from "__entitykit_migrations" where "id" = $1',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });

    it('exposes migration script generation and execution from DbContext', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const migration = new CreateUsersMigration();

        expect(contextMigrations(db).generateScript(migration)).toContain('CreateUsers');

        connection.queueResult(); // acquire lock
        for (let i = 0; i < 5; i++) {
            connection.queueResult({ rowCount: 1 });
        }
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await contextMigrations(db).apply(migration);

        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('rejects structurally similar objects without an EntityKit runtime host', () => {
        const connection = new RecordingDatabaseConnection();

        expect(() => contextMigrations({
            database: { connection, providerName: 'fake' },
        })).toThrow(
            'contextMigrations() requires a DbContext instance created by EntityKit.',
        );
    });
});
