import { requireDefined } from '../support/require-defined';
import { postgresProviderServices } from '../../packages/postgres/src';
import {
    defineProviderContractTests,
    expectDatabaseProviderError,
    type ProviderContractRuntime,
} from '../support/provider-contract';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

describePostgres('Postgres provider contract integration', () => {
    defineProviderContractTests('postgres', (): ProviderContractRuntime => {
        const provider = postgresProviderServices;

        return {
            providerName: 'postgres',
            providerServices: provider,
            expectedSelectStatement: {
                text: 'select "id", "email" from "provider_contract_users" where "email" = $1',
                values: ['a@example.com'],
            },
            expectedRawSqlStatement: {
                text: 'select $1 as email, $2 as answer',
                values: ['a@example.com', 42],
            },
            expectedMigrationOperationFragments: [
                'create table if not exists "provider_contract_operations" ("id" text primary key, "email" text)',
                'alter table "provider_contract_operations" add column "display_name" text',
                'create unique index if not exists "ix_provider_contract_operations_email" on "provider_contract_operations" ("email")',
                'alter table "provider_contract_operations" rename column "display_name" to "name"',
                'alter table "provider_contract_operations" rename to "provider_contract_accounts"',
                'alter table "provider_contract_accounts" drop column "name"',
                'drop index if exists "ix_provider_contract_operations_email"',
                'insert into "__entitykit_migrations" ("id", "name", "checksum", "entitykit_version") values (\'20260601160000_ExerciseProviderMigrationOperations\'',
            ],
            expectedIdempotentScriptFragments: [
                'do $entitykit$',
                'if not exists',
                '\'20260601150000_CreateProviderContractUsers\'',
                'insert into "__entitykit_migrations"',
            ],
            expectedUsesMigrationLock: true,
            expectedMaxStatementParameters: 65535,
            expectedSupportsUpsert: true,
            expectedSupportsStreaming: true,
            configure(options) {
                options.useProvider(provider, requireDefined(process.env.DATABASE_URL));
            },
            async beforeEach(db) {
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_children" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_parents" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_users" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_values" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
                await db.database.connection.query({ text: db.database.createScript(), values: [] });
            },
            async afterEach(db) {
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_children" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_parents" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_users" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_values" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
            },
            async prepareValueRoundTrip(db) {
                // `beforeEach` already created the table from the model schema script.
                await db.database.connection.query({ text: 'delete from "provider_contract_values"', values: [] });
            },
            async prepareJoinData(db) {
                // `beforeEach` created the tables from the model schema script.
                await db.database.connection.query({ text: 'delete from "provider_contract_children"', values: [] });
                await db.database.connection.query({ text: 'delete from "provider_contract_parents"', values: [] });
            },
            async afterSaveAndRead(db, user) {
                const result = await db.database.connection.query<{ email: string }>({
                    text: 'select "email" from "provider_contract_users" where "id" = $1',
                    values: [user.id],
                });
                expect(result.rows[0]).toEqual({ email: 'a@example.com' });
            },
            async afterRollback(db) {
                const result = await db.database.connection.query<{ count: number }>({
                    text: 'select count(*)::int as "count" from "provider_contract_users" where "id" = $1',
                    values: ['usr_rollback'],
                });
                expect(result.rows[0]?.count).toBe(0);
            },
            async beforeNestedTransaction(db) {
                await db.database.connection.query({ text: 'delete from "provider_contract_users" where "id" = $1', values: ['usr_nested'] });
            },
            async afterNestedTransaction(db) {
                const result = await db.database.connection.query<{ count: number }>({
                    text: 'select count(*)::int as "count" from "provider_contract_users" where "id" = $1',
                    values: ['usr_nested'],
                });
                expect(result.rows[0]?.count).toBe(1);
            },
            async beforeMigrationUpdate(db) {
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_users" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_values" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
            },
            async afterMigrationUpdate(db) {
                const result = await db.database.connection.query<{ id: string }>({
                    text: 'select "id" from "__entitykit_migrations" order by "id"',
                    values: [],
                });
                expect(result.rows.map(row => row.id)).toEqual(['20260601150000_CreateProviderContractUsers']);
            },
            async beforeMigrationRollback(db) {
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_users" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "provider_contract_values" cascade', values: [] });
                await db.database.connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
            },
            async afterMigrationRollback(db) {
                const history = await db.database.connection.query<{ count: number }>({
                    text: 'select count(*)::int as "count" from "__entitykit_migrations"',
                    values: [],
                });
                const table = await db.database.connection.query<{ table_name: string | null }>({
                    text: 'select to_regclass(\'public.provider_contract_users\')::text as table_name',
                    values: [],
                });
                expect(history.rows[0]?.count).toBe(0);
                expect(table.rows[0]?.table_name).toBeNull();
            },
            async expectSchemaIntrospection(db) {
                const introspector = provider.createSchemaIntrospector?.(
                    db.database.connection,
                );
                expect(introspector).toBeDefined();
                const snapshot = await requireDefined(introspector).introspect({ schemas: ['public'] });
                expect(snapshot.schemas.some(schema => schema.name === 'public')).toBe(true);
            },
            async expectProviderError(db) {
                let caught: unknown;
                try {
                    await db.database.connection.query({ text: 'select * from "entitykit_missing_contract_table"', values: [] });
                } catch (error) {
                    caught = error;
                }
                expectDatabaseProviderError(caught, 'postgres', 'query');
            },
        };
    });
});
