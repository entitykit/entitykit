import {
    DatabaseProviderError,
    TransactionOutcomeUnknownError,
} from '../packages/core/src';
import { RecordingDatabaseConnection } from '../packages/testing/src';
import { GuardedDatabaseConnection } from '../packages/core/src/storage/guarded-database-connection';

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows) {
        values.push(row);
    }
    return values;
}

describe('guarded database connection', () => {
    it('does not start a deferred stream after commit outcome becomes unknown', async () => {
        const inner = new RecordingDatabaseConnection();
        const connection = new GuardedDatabaseConnection(inner);
        const failure = new TransactionOutcomeUnknownError(
            'test',
            new DatabaseProviderError(
                'Commit acknowledgement was lost.',
                undefined,
                { provider: 'test', operation: 'commit' },
            ),
        );
        const stream = connection.stream({ text: 'select 1', values: [] });
        inner.failNextTransactionCommit(failure);

        await expect(connection.transaction(() => undefined))
            .rejects.toBe(failure);
        await expect(collect(stream)).rejects.toBe(failure);
        expect(inner.operations.map(operation => operation.kind))
            .toEqual(['begin', 'rollback']);
    });
});
