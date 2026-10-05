import { OperationCanceledError } from '../packages/core/src';
import { PostgresPooledConnection } from '../packages/postgres/src/postgres-pooled-connection';
import type { Pool, PoolClient } from '../packages/postgres/src/postgres-driver';

describe('Postgres short final stream batches', () => {
    it.each([false, true])('observes abort after the final row (caller transaction=%s)', async callerTransaction => {
        const query = jest.fn(async (text: string) => {
            await Promise.resolve();
            if (text.startsWith('fetch forward')) return { rows: [{ id: 1 }], rowCount: 1 };
            if (text === 'select 1 as healthy') return { rows: [{ healthy: 1 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });
        const release = jest.fn();
        const client = { query, release } as unknown as PoolClient;
        const pool = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
        const connection = new PostgresPooledConnection(pool);
        const read = async (): Promise<void> => {
            const controller = new AbortController();
            const iterator = connection.stream(
                { text: 'select id from widgets', values: [] },
                { batchSize: 2, signal: controller.signal },
            )[Symbol.asyncIterator]();
            await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 1 } });
            controller.abort('stop after short final batch');
            await expect(iterator.next()).rejects.toBeInstanceOf(OperationCanceledError);
            if (callerTransaction) {
                expect(release).not.toHaveBeenCalled();
                await expect(connection.query({ text: 'select 1 as healthy', values: [] }))
                    .resolves.toMatchObject({ rows: [{ healthy: 1 }] });
            }
        };
        if (callerTransaction) await connection.transaction(read);
        else await read();
        const commands = query.mock.calls.map(([text]) => text);
        expect(commands.filter(text => text.startsWith('fetch forward'))).toHaveLength(1);
        expect(release).toHaveBeenCalledTimes(1);
        if (callerTransaction) {
            expect(commands).toEqual([
                'begin', expect.stringMatching(/^declare entitykit_stream_/),
                expect.stringMatching(/^fetch forward 2/), expect.stringMatching(/^close entitykit_stream_/),
                'select 1 as healthy', 'commit',
            ]);
            expect(release).toHaveBeenCalledWith(undefined);
        } else {
            expect(commands).toEqual([
                'begin read only', expect.stringMatching(/^declare entitykit_stream_/),
                expect.stringMatching(/^fetch forward 2/),
            ]);
            expect(release).toHaveBeenCalledWith(true);
        }
    });
});
