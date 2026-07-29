import { requireDefined } from './support/require-defined';
import { sqliteProviderServices } from '../src/providers/sqlite';
import {
    defineProviderContractTests,
    expectDatabaseProviderError,
    type ProviderContractRuntime,
} from './support/provider-contract';

// SQLite generates the same migration operation SQL as Postgres here: both use
// standard double-quoted identifiers and the shared migration builder.
const MIGRATION_OPERATION_FRAGMENTS = [
    'create table if not exists "provider_contract_operations" ("id" text primary key, "email" text)',
    'alter table "provider_contract_operations" add column "display_name" text',
    'create unique index if not exists "ix_provider_contract_operations_email" on "provider_contract_operations" ("email")',
    'alter table "provider_contract_operations" rename column "display_name" to "name"',
    'alter table "provider_contract_operations" rename to "provider_contract_accounts"',
    'alter table "provider_contract_accounts" drop column "name"',
    'drop index if exists "ix_provider_contract_operations_email"',
    'insert into "__entitykit_migrations" ("id", "name", "checksum", "entitykit_version") values (\'20260601160000_ExerciseProviderMigrationOperations\'',
];

async function dropContractTables(db: { database: { connection: { query(statement: { text: string; values: unknown[] }): Promise<unknown> } } }): Promise<void> {
    await db.database.connection.query({ text: 'drop table if exists "provider_contract_users"', values: [] });
    await db.database.connection.query({ text: 'drop table if exists "__entitykit_migrations"', values: [] });
}

defineProviderContractTests('sqlite', (): ProviderContractRuntime => {
    return {
        providerName: 'sqlite',
        providerServices: sqliteProviderServices,
        expectedSelectStatement: {
            text: 'select "id", "email" from "provider_contract_users" where "email" = ?',
            values: ['a@example.com'],
        },
        expectedRawSqlStatement: {
            text: 'select ? as email, ? as answer',
            values: ['a@example.com', 42],
        },
        expectedMigrationOperationFragments: MIGRATION_OPERATION_FRAGMENTS,
        // SQLite has no advisory locks and no idempotent do-block:
        expectedUsesMigrationLock: false,
        expectedMaxStatementParameters: 32766,
        expectedSupportsUpsert: true,
        expectedSupportsStreaming: true,
        configure(options) {
            options.useProvider(sqliteProviderServices, ':memory:');
        },
        async beforeEach(db) {
            // Each test gets a fresh in-memory database; create the model table.
            await db.database.connection.query({
                text: 'create table if not exists "provider_contract_users" ("id" text primary key, "email" text)',
                values: [],
            });
        },
        async prepareValueRoundTrip(db) {
            await db.database.connection.query({
                text: 'create table if not exists "provider_contract_values" ("id" text primary key, "is_active" boolean not null, "recorded_at" timestamptz not null, "payload" jsonb not null, "score" integer not null, "label" text)',
                values: [],
            });
            await db.database.connection.query({ text: 'delete from "provider_contract_values"', values: [] });
        },
        async prepareJoinData(db) {
            // A fresh in-memory database per test, so create the join tables here.
            await db.database.connection.query({
                text: 'create table if not exists "provider_contract_parents" ("id" text primary key, "name" text not null)',
                values: [],
            });
            await db.database.connection.query({
                text: 'create table if not exists "provider_contract_children" ("id" text primary key, "parent_id" text not null, "score" integer not null, foreign key ("parent_id") references "provider_contract_parents" ("id"))',
                values: [],
            });
        },
        async afterSaveAndRead(db, user) {
            const result = await db.database.connection.query<{ email: string }>({
                text: 'select "email" from "provider_contract_users" where "id" = ?',
                values: [user.id],
            });
            expect(result.rows[0]).toEqual({ email: 'a@example.com' });
        },
        async afterRollback(db) {
            const result = await db.database.connection.query<{ count: number }>({
                text: 'select count(*) as "count" from "provider_contract_users" where "id" = ?',
                values: ['usr_rollback'],
            });
            expect(result.rows[0]?.count).toBe(0);
        },
        async afterNestedTransaction(db) {
            const result = await db.database.connection.query<{ count: number }>({
                text: 'select count(*) as "count" from "provider_contract_users" where "id" = ?',
                values: ['usr_nested'],
            });
            expect(result.rows[0]?.count).toBe(1);
        },
        async beforeMigrationUpdate(db) {
            await dropContractTables(db);
        },
        async afterMigrationUpdate(db) {
            const result = await db.database.connection.query<{ id: string }>({
                text: 'select "id" from "__entitykit_migrations" order by "id"',
                values: [],
            });
            expect(result.rows.map(row => row.id)).toEqual(['20260601150000_CreateProviderContractUsers']);
        },
        async beforeMigrationRollback(db) {
            await dropContractTables(db);
        },
        async afterMigrationRollback(db) {
            const history = await db.database.connection.query<{ count: number }>({
                text: 'select count(*) as "count" from "__entitykit_migrations"',
                values: [],
            });
            const table = await db.database.connection.query<{ count: number }>({
                text: 'select count(*) as "count" from sqlite_master where type = \'table\' and name = \'provider_contract_users\'',
                values: [],
            });
            expect(history.rows[0]?.count).toBe(0);
            expect(table.rows[0]?.count).toBe(0);
        },
        async expectSchemaIntrospection(db) {
            const introspector = sqliteProviderServices
                .createSchemaIntrospector?.(db.database.connection);
            expect(introspector).toBeDefined();

            const snapshot = await requireDefined(introspector).introspect();
            // SQLite's implicit `main` database is reported as an empty schema so a
            // pulled model stays unqualified (SQLite has no `create schema`).
            const main = snapshot.schemas.find(schema => schema.name === '');
            expect(main).toBeDefined();

            const table = requireDefined(main).tables.find(candidate => candidate.tableName === 'provider_contract_users');
            expect(table).toBeDefined();
            expect(requireDefined(table).columns.map(column => column.name).sort()).toEqual(['email', 'id']);
            expect(requireDefined(table).primaryKey?.columns).toEqual(['id']);
        },
        async expectProviderError(db) {
            let caught: unknown;
            try {
                await db.database.connection.query({ text: 'select * from "entitykit_missing_contract_table"', values: [] });
            } catch (error) {
                caught = error;
            }
            expectDatabaseProviderError(caught, 'sqlite', 'query');
        },
    };
});
