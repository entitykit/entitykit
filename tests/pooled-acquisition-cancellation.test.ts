import { OperationCanceledError, type DatabaseConnection } from '@entitykit/core';
import { PostgresPooledConnection } from '../packages/postgres/src/postgres-pooled-connection';
import type { Pool } from '../packages/postgres/src/postgres-driver';
import { MySqlPooledConnection } from '../packages/mysql/src/mysql-pooled-connection';
import type { MySqlPool } from '../packages/mysql/src/mysql-driver';

type Provider = 'postgres' | 'mysql';
type Operation = 'query' | 'stream' | 'transaction' | 'session';

function fixture(provider: Provider): {
    connection: DatabaseConnection;
    deliver: () => void;
    fail: (error: Error) => void;
    acquire: jest.Mock;
    query: jest.Mock;
    release: jest.Mock;
    destroy: jest.Mock;
} {
    const query = jest.fn(async () => Promise.resolve(provider === 'postgres'
        ? { rows: [], rowCount: 0 }
        : [[], []]));
    const release = jest.fn();
    const destroy = jest.fn();
    const client = { query, release, destroy, connection: { query: jest.fn() } };
    let deliver!: () => void;
    let fail!: (error: Error) => void;
    const queued: Promise<typeof client> = new Promise((resolve, reject) => {
        deliver = () => {
            resolve(client);
        };
        fail = reject;
    });
    const acquire = jest.fn(async () => queued);
    const connection = provider === 'postgres'
        ? new PostgresPooledConnection({ connect: acquire, query } as unknown as Pool)
        : new MySqlPooledConnection({ getConnection: acquire, query } as unknown as MySqlPool);
    return { connection, deliver, fail, acquire, query, release, destroy };
}

async function execute(
    connection: DatabaseConnection,
    operation: Operation,
    signal: AbortSignal,
    work: jest.Mock,
): Promise<unknown> {
    switch (operation) {
        case 'query': return connection.query({ text: 'select 1', values: [] }, { signal });
        case 'stream': {
            const stream = connection.stream?.({ text: 'select 1', values: [] }, { signal });
            return stream?.[Symbol.asyncIterator]().next()
                ?? Promise.reject(new Error('Missing stream'));
        }
        case 'transaction': return connection.transaction(work, { signal });
        case 'session': return connection.session?.(work, { signal }) ?? Promise.reject(new Error('Missing session'));
    }
}

describe.each<Provider>(['postgres', 'mysql'])('%s queued acquisition', provider => {
    it.each<Operation>(['query', 'stream', 'transaction', 'session'])(
        'cancels %s before acquisition completes and reclaims the late connection',
        async operation => {
            const f = fixture(provider);
            const controller = new AbortController();
            const work = jest.fn();
            const pending = execute(f.connection, operation, controller.signal, work);
            controller.abort('pool admission deadline');

            await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);
            expect(f.acquire).toHaveBeenCalledTimes(1);
            expect(f.query).not.toHaveBeenCalled();
            expect(work).not.toHaveBeenCalled();
            f.deliver();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(f.release).toHaveBeenCalledTimes(1);
            expect(f.destroy).not.toHaveBeenCalled();
            expect(f.connection.isInTransaction).toBe(false);
        },
    );

    it.each<Operation>(['query', 'stream', 'transaction', 'session'])(
        'observes a late acquisition failure after canceling %s',
        async operation => {
            const f = fixture(provider);
            const controller = new AbortController();
            const pending = execute(f.connection, operation, controller.signal, jest.fn());
            controller.abort('pool admission deadline');
            await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);

            f.fail(new Error('pool closed'));
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(f.release).not.toHaveBeenCalled();
            expect(f.destroy).not.toHaveBeenCalled();
        },
    );
});
