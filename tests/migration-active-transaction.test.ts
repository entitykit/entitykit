import type {
    MigrationBuilder } from '../src/migrations/api';
import {
    Migration,
    MigrationError,
    MigrationRunner,
} from '../src/migrations/api';
import { RecordingDatabaseConnection } from '../src/testing';

class TransactionBoundaryMigration extends Migration {
    public readonly id = '20260729000003_TransactionBoundary';
    public readonly name = 'TransactionBoundary';

    public override up(builder: MigrationBuilder): void {
        builder.sql('create index concurrently ix_items_name on items (name)', {
            suppressTransaction: true,
        });
    }

    public override down(builder: MigrationBuilder): void {
        builder.sql('drop index concurrently ix_items_name', {
            suppressTransaction: true,
        });
    }
}

describe('migration transaction ownership', () => {
    it.each([
        ['apply', async (runner: MigrationRunner, migration: Migration) =>
            runner.apply(migration)],
        ['revert', async (runner: MigrationRunner, migration: Migration) =>
            runner.revert(migration)],
        ['update', async (runner: MigrationRunner, migration: Migration) =>
            runner.update([migration])],
    ] as const)('rejects %s inside an active user transaction', async (
        operation,
        run,
    ) => {
        const connection = new RecordingDatabaseConnection();
        const runner = new MigrationRunner(connection);
        const migration = new TransactionBoundaryMigration();

        await connection.transaction(async () => {
            const attempt = run(runner, migration);
            await expect(attempt).rejects.toBeInstanceOf(MigrationError);
            await expect(attempt).rejects.toThrow(
                `Migration ${operation} cannot run inside an active transaction`,
            );
        });

        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
    });
});
