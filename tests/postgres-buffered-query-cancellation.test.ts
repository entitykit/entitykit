import { OperationCanceledError } from '../src';
import { PostgresPooledConnection } from '../src/providers/postgres/postgres-pooled-connection';
import type { Pool, PoolClient } from '../src/providers/postgres/postgres-driver';

function fixture(query: jest.Mock): {
    readonly connection: PostgresPooledConnection;
    readonly connect: jest.Mock;
    readonly release: jest.Mock;
} {
    const release = jest.fn();
    const client = { query, release } as unknown as PoolClient;
    const connect = jest.fn().mockResolvedValue(client);
    const pool = { connect, query: jest.fn() } as unknown as Pool;
    return {
        connection: new PostgresPooledConnection(pool),
        connect,
        release,
    };
}

describe('Postgres buffered query cancellation', () => {
    it('interrupts an in-flight query by destroying its owned lease', async () => {
        const query = jest.fn(async () => new Promise(() => undefined));
        const { connection, release } = fixture(query);
        const controller = new AbortController();

        const pending = connection.query(
            { text: 'select pg_sleep(10)', values: [] },
            { signal: controller.signal },
        );
        await new Promise<void>(resolve => setImmediate(resolve));
        controller.abort('stop query');

        await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);
        expect(release).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledWith(true);
    });

    it('cancels cooperatively inside a transaction so rollback remains usable', async () => {
        const controller = new AbortController();
        const query = jest.fn(async (text: string) => {
            await Promise.resolve();
            if (text === 'select work') {
                controller.abort('stop transaction');
            }
            return { rows: [], rowCount: 0 };
        });
        const { connection, release } = fixture(query);

        await expect(connection.transaction(
            async () => connection.query(
                { text: 'select work', values: [] },
                { signal: controller.signal },
            ),
            { signal: controller.signal },
        )).rejects.toBeInstanceOf(OperationCanceledError);

        expect(query.mock.calls.map(call => call[0])).toEqual([
            'begin',
            'select work',
            'rollback',
        ]);
        expect(release).toHaveBeenCalledWith(undefined);
        expect(release).not.toHaveBeenCalledWith(true);
    });
});
