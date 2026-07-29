import { requireDefined } from '../support/require-defined';
import { mySqlProviderServices } from '../../src/providers/mysql';
import {
    defineProviderContractTests,
    expectDatabaseProviderError,
    type ProviderContractRuntime,
} from '../support/provider-contract';

const url = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const shouldRun = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(url);
const describeMysql = shouldRun ? describe : describe.skip;

// The MySQL migration DDL, backtick-quoted and provider-mapped: no
// `if not exists` on the index (MySQL rejects it) and `drop index ... on
// <table>` (it needs the table). Generated, not guessed.
const MIGRATION_OPERATION_FRAGMENTS = [
    'create table if not exists `provider_contract_operations` (`id` varchar(255) collate utf8mb4_bin primary key, `email` text collate utf8mb4_bin)',
    'alter table `provider_contract_operations` add column `display_name` text collate utf8mb4_bin',
    'create unique index `ix_provider_contract_operations_email` on `provider_contract_operations` (`email`)',
    'alter table `provider_contract_operations` rename column `display_name` to `name`',
    'alter table `provider_contract_operations` rename to `provider_contract_accounts`',
    'alter table `provider_contract_accounts` drop column `name`',
    'drop index `ix_provider_contract_operations_email` on `provider_contract_accounts`',
    'insert into `__entitykit_migrations` (`id`, `name`, `checksum`, `entitykit_version`) values (\'20260601160000_ExerciseProviderMigrationOperations\'',
];

describeMysql('MySQL provider contract integration', () => {
    defineProviderContractTests('mysql', (): ProviderContractRuntime => {
        const provider = mySqlProviderServices;

        const dropAll = async (db: { database: { connection: { query(statement: { text: string; values: unknown[] }): Promise<unknown> } } }): Promise<void> => {
            // Children before parents: the foreign key blocks dropping the parent first.
            await db.database.connection.query({ text: 'drop table if exists provider_contract_children', values: [] });
            await db.database.connection.query({ text: 'drop table if exists provider_contract_parents', values: [] });
            await db.database.connection.query({ text: 'drop table if exists provider_contract_users', values: [] });
            await db.database.connection.query({ text: 'drop table if exists provider_contract_values', values: [] });
            await db.database.connection.query({ text: 'drop table if exists __entitykit_migrations', values: [] });
        };

        return {
            providerName: 'mysql',
            providerServices: provider,
            expectedSelectStatement: {
                text: 'select `id`, `email` from `provider_contract_users` where `email` = ?',
                values: ['a@example.com'],
            },
            expectedRawSqlStatement: {
                text: 'select ? as email, ? as answer',
                values: ['a@example.com', 42],
            },
            expectedMigrationOperationFragments: MIGRATION_OPERATION_FRAGMENTS,
            // MySQL named locks serialize migration runners on a pinned session.
            expectedUsesMigrationLock: true,
            expectedMaxStatementParameters: 65535,
            expectedSupportsUpsert: true,
            expectedSupportsStreaming: true,
            configure(options) {
                options.useProvider(provider, requireDefined(url));
            },
            async beforeEach(db) {
                await dropAll(db);
                await db.database.connection.query({ text: db.database.createScript(), values: [] });
            },
            async afterEach(db) {
                await dropAll(db);
            },
            async prepareValueRoundTrip(db) {
                await db.database.connection.query({ text: 'delete from provider_contract_values', values: [] });
            },
            async prepareJoinData(db) {
                // Tables are created fresh by beforeEach's schema script; clear defensively.
                await db.database.connection.query({ text: 'delete from provider_contract_children', values: [] });
                await db.database.connection.query({ text: 'delete from provider_contract_parents', values: [] });
            },
            async afterSaveAndRead(db, user) {
                const result = await db.database.connection.query<{ email: string }>({
                    text: 'select `email` from `provider_contract_users` where `id` = ?',
                    values: [user.id],
                });
                expect(result.rows[0]).toEqual({ email: 'a@example.com' });
            },
            async afterRollback(db) {
                const result = await db.database.connection.query<{ count: number }>({
                    text: 'select count(*) as `count` from `provider_contract_users` where `id` = ?',
                    values: ['usr_rollback'],
                });
                expect(result.rows[0]?.count).toBe(0);
            },
            async beforeNestedTransaction(db) {
                await db.database.connection.query({ text: 'delete from provider_contract_users where id = ?', values: ['usr_nested'] });
            },
            async afterNestedTransaction(db) {
                const result = await db.database.connection.query<{ count: number }>({
                    text: 'select count(*) as `count` from `provider_contract_users` where `id` = ?',
                    values: ['usr_nested'],
                });
                expect(result.rows[0]?.count).toBe(1);
            },
            async beforeMigrationUpdate(db) {
                await dropAll(db);
            },
            async afterMigrationUpdate(db) {
                const result = await db.database.connection.query<{ id: string }>({
                    text: 'select `id` from `__entitykit_migrations` order by `id`',
                    values: [],
                });
                expect(result.rows.map(row => row.id)).toEqual(['20260601150000_CreateProviderContractUsers']);
            },
            async beforeMigrationRollback(db) {
                await dropAll(db);
            },
            async afterMigrationRollback(db) {
                const history = await db.database.connection.query<{ count: number }>({
                    text: 'select count(*) as `count` from `__entitykit_migrations`',
                    values: [],
                });
                const table = await db.database.connection.query<{ count: number }>({
                    text: 'select count(*) as `count` from information_schema.tables where table_schema = database() and table_name = \'provider_contract_users\'',
                    values: [],
                });
                expect(history.rows[0]?.count).toBe(0);
                expect(table.rows[0]?.count).toBe(0);
            },
            async expectSchemaIntrospection(db) {
                const introspector = provider.createSchemaIntrospector?.(
                    db.database.connection,
                );
                expect(introspector).toBeDefined();
                const snapshot = await requireDefined(introspector).introspect();
                // MySQL's current database is reported as an empty schema (like SQLite).
                const current = snapshot.schemas.find(schema => schema.name === '');
                expect(current).toBeDefined();
                const table = requireDefined(current).tables.find(candidate => candidate.tableName === 'provider_contract_users');
                expect(table).toBeDefined();
                expect(requireDefined(table).columns.map(column => column.name).sort()).toEqual(['email', 'id']);
                expect(requireDefined(table).primaryKey?.columns).toEqual(['id']);
            },
            async expectProviderError(db) {
                let caught: unknown;
                try {
                    await db.database.connection.query({ text: 'select * from `entitykit_missing_contract_table`', values: [] });
                } catch (error) {
                    caught = error;
                }
                expectDatabaseProviderError(caught, 'mysql', 'query');
            },
        };
    });
});
