import { DatabaseProviderError } from '../src';
import { DbContextOptionsBuilder } from '../src/core/context-options/db-context-options-builder';
import { MigrationSqlGenerator } from '../src/migrations/api';
import { createFakeProvider } from './support/fake-provider';
import {
    CreateProviderContractUsers,
    contractMigrationHistoryRow,
    defineProviderContractTests,
    expectDatabaseProviderError,
    type ProviderContractRuntime,
} from './support/provider-contract';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

defineProviderContractTests('fake', (): ProviderContractRuntime => {
    const connection = new RecordingDatabaseConnection();
    const provider = createFakeProvider({ connection });

    return {
        providerName: 'fake-provider',
        providerServices: provider,
        expectedSelectStatement: {
            text: 'select `id`, `email` from `provider_contract_users` where `email` = ?',
            values: ['a@example.com'],
        },
        expectedRawSqlStatement: {
            text: 'select ? as email, ? as answer',
            values: ['a@example.com', 42],
        },
        expectedMigrationOperationFragments: [
            'create table if not exists `provider_contract_operations` (`id` text primary key, `email` text)',
            'alter table `provider_contract_operations` add column `display_name` text',
            'create unique index if not exists `ix_provider_contract_operations_email` on `provider_contract_operations` (`email`)',
            'alter table `provider_contract_operations` rename column `display_name` to `name`',
            'alter table `provider_contract_operations` rename to `provider_contract_accounts`',
            'alter table `provider_contract_accounts` drop column `name`',
            'drop index if exists `ix_provider_contract_operations_email`',
            'insert into `entitykit_migrations` (`id`, `name`, `checksum`, `entitykit_version`) values (\'20260601160000_ExerciseProviderMigrationOperations\'',
        ],
        expectedUsesMigrationLock: false,
        expectedMaxStatementParameters: null,
        expectedSupportsUpsert: false,
        expectedSupportsStreaming: false,
        configure(options) {
            options.useProvider(provider, {
                connectionString: 'fake://contract-test',
                connection,
            });
        },
        beforeSave() {
            connection.queueResult({ rowCount: 1 });
        },
        beforeRead() {
            connection.queueResult({
                rows: [{ id: 'usr_contract', email: 'a@example.com' }],
                rowCount: 1,
            });
        },
        afterSaveAndRead() {
            expect(connection.statements.map(statement => statement.text)).toEqual([
                'insert into `provider_contract_users` (`id`, `email`) values (?, ?)',
                'select `id`, `email` from `provider_contract_users` where `email` = ? limit ?',
            ]);
        },
        beforeRollback() {
            connection.queueResult({ rowCount: 1 });
        },
        afterRollback() {
            expect(connection.transactionEvents).toEqual(['begin', 'savepoint:entitykit_sp_1', 'release:entitykit_sp_1', 'rollback']);
        },
        beforeNestedTransaction() {
            connection.queueResult({ rowCount: 1 });
        },
        afterNestedTransaction() {
            expect(connection.transactionEvents).toEqual(['begin', 'savepoint:entitykit_sp_1', 'savepoint:entitykit_sp_2', 'release:entitykit_sp_2', 'release:entitykit_sp_1', 'commit']);
        },
        beforeDiagnosticsSave() {
            connection.queueResult({ rowCount: 1 });
        },
        beforeMigrationUpdate() {
            connection.queueResult();
            connection.queueResult();
            connection.queueResult({ rows: [] });
            connection.queueResult();
            connection.queueResult({ rowCount: 1 });
        },
        beforeSecondMigrationUpdate(_db, migration) {
            connection.queueResult();
            connection.queueResult();
            connection.queueResult({ rows: [contractMigrationHistoryRow(migration, provider)] });
        },
        afterMigrationUpdate() {
            expect(connection.statements.map(statement => statement.text).join('\n')).not.toContain('pg_advisory');
        },
        beforeMigrationRollback(_db, migration) {
            connection.queueResult();
            connection.queueResult();
            connection.queueResult({ rows: [] });
            connection.queueResult();
            connection.queueResult({ rowCount: 1 });
            connection.queueResult();
            connection.queueResult();
            connection.queueResult({ rows: [contractMigrationHistoryRow(migration, provider)] });
            connection.queueResult();
            connection.queueResult({ rowCount: 1 });
        },
        afterMigrationRollback() {
            expect(connection.statements.map(statement => statement.text).join('\n')).toContain('delete from `entitykit_migrations` where `id` = ?');
            expect(connection.statements.map(statement => statement.text).join('\n')).not.toContain('pg_advisory');
        },
        async expectProviderError(db) {
            const providerError = new DatabaseProviderError(
                'Fake provider query failed.',
                { code: 'FAKE_CONTRACT' },
                { provider: 'fake-provider', operation: 'query' },
            );
            connection.queueError(providerError);

            let caught: unknown;
            try {
                await db.database.connection.query({ text: 'select broken', values: [] });
            } catch (error) {
                caught = error;
            }
            expectDatabaseProviderError(caught, 'fake-provider', 'query');
        },
    };
});

describe('provider migration contract validation', () => {
    it('fails clearly when a provider omits the migration builder factory', () => {
        const provider = createFakeProvider();
        const brokenProvider = {
            ...provider,
            createMigrationBuilder: undefined,
        };

        expect(() => new DbContextOptionsBuilder().useProvider(brokenProvider as never, 'fake://missing-builder'))
            .toThrow('Database provider \'fake-provider\' must supply a migration builder factory.');
    });

    it('fails optional idempotent script support with the provider dialect name', () => {
        const provider = createFakeProvider();
        const generator = new MigrationSqlGenerator(
            provider.migrationDialect,
            provider.createMigrationBuilder,
        );

        expect(() => generator.generateScript([new CreateProviderContractUsers()], { idempotent: true }))
            .toThrow('Idempotent scripts are not supported by migration dialect \'fake-migration-sql\'.');
    });

    it('rejects fake-provider unsupported migration DDL with provider-owned next actions', () => {
        const provider = createFakeProvider();
        const builder = provider.createMigrationBuilder();

        expect(() => builder.createIndex({ name: 'ix_users_email', tableName: 'users', columns: ['email'], concurrently: true }))
            .toThrow('Migration operation \'createIndex(concurrently)\' is not supported by provider \'fake-provider\'. Implement concurrent index DDL in the provider migration builder');
        expect(() => builder.createExtension('uuid-ossp'))
            .toThrow('Migration operation \'createExtension\' is not supported by provider \'fake-provider\'. Implement extension DDL in the provider migration builder');
    });
});
