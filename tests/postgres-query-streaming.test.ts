import { OperationCanceledError } from '../src';
import { PostgresPooledConnection } from '../src/providers/postgres/postgres-pooled-connection';
import type { Pool, PoolClient } from '../src/providers/postgres/postgres-driver';

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows) {
        values.push(row);
    }
    return values;
}

function postgresFixture(query: jest.Mock): {
    readonly connection: PostgresPooledConnection;
    readonly release: jest.Mock;
} {
    const release = jest.fn();
    const client = { query, release } as unknown as PoolClient;
    const pool = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
    return { connection: new PostgresPooledConnection(pool), release };
}

describe('Postgres query streaming', () => {
    it('uses a bounded server cursor and parameterized declaration', async () => {
        let fetchCount = 0;
        const query = jest.fn(async (text: string) => {
            await Promise.resolve();
            if (text.startsWith('fetch forward')) {
                fetchCount++;
                return fetchCount === 1
                    ? { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 }
                    : { rows: [], rowCount: 0 };
            }
            return { rows: [], rowCount: 0 };
        });
        const { connection, release } = postgresFixture(query);

        await expect(collect(connection.stream(
            { text: 'select id from widgets where tenant_id = $1', values: ['tenant_1'] },
            { batchSize: 2 },
        ))).resolves.toEqual([{ id: 1 }, { id: 2 }]);

        expect(query.mock.calls).toEqual([
            ['begin read only'],
            [expect.stringMatching(/^declare entitykit_stream_\d+ no scroll cursor for select id from widgets where tenant_id = \$1$/), ['tenant_1']],
            [expect.stringMatching(/^fetch forward 2 from entitykit_stream_\d+$/)],
            [expect.stringMatching(/^fetch forward 2 from entitykit_stream_\d+$/)],
            [expect.stringMatching(/^close entitykit_stream_\d+$/)],
            ['commit'],
        ]);
        expect(release).toHaveBeenCalledWith(undefined);
    });

    it('interrupts an in-flight fetch by destroying its owned lease', async () => {
        let rejectFetch: ((reason?: unknown) => void) | undefined;
        const query = jest.fn(async (text: string) => {
            if (text.startsWith('fetch forward')) {
                return await new Promise((_resolve, reject) => {
                    rejectFetch = reject;
                });
            }
            await Promise.resolve();
            return { rows: [], rowCount: 0 };
        });
        const { connection, release } = postgresFixture(query);
        release.mockImplementation((destroy?: boolean) => {
            if (destroy) {
                rejectFetch?.(new Error('connection terminated'));
            }
        });
        const controller = new AbortController();
        const iterator = connection.stream(
            { text: 'select id from widgets', values: [] },
            { batchSize: 1, signal: controller.signal },
        )[Symbol.asyncIterator]();

        const first = iterator.next();
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(rejectFetch).toBeDefined();
        controller.abort('stop fetch');

        await expect(first).rejects.toBeInstanceOf(OperationCanceledError);
        expect(release).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledWith(true);
        expect(query.mock.calls.map(call => call[0])).not.toEqual(
            expect.arrayContaining([expect.stringMatching(/^close |^rollback$/)]),
        );
    });

    it('closes a canceled cursor without invalidating an explicit transaction', async () => {
        let fetchCount = 0;
        const query = jest.fn(async (text: string) => {
            await Promise.resolve();
            if (text.startsWith('fetch forward')) {
                fetchCount++;
                return fetchCount === 1
                    ? { rows: [{ id: 1 }], rowCount: 1 }
                    : { rows: [], rowCount: 0 };
            }
            if (text === 'select count(*) as count') {
                return { rows: [{ count: 2 }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        });
        const { connection, release } = postgresFixture(query);

        await connection.transaction(async () => {
            const controller = new AbortController();
            const iterator = connection.stream(
                { text: 'select id from widgets', values: [] },
                { batchSize: 1, signal: controller.signal },
            )[Symbol.asyncIterator]();
            await iterator.next();
            controller.abort('stop transaction stream');
            await expect(iterator.next()).rejects.toBeInstanceOf(
                OperationCanceledError,
            );
            await expect(connection.query<{ count: number }>({
                text: 'select count(*) as count',
                values: [],
            })).resolves.toMatchObject({ rows: [{ count: 2 }] });
        });

        expect(query.mock.calls.map(call => call[0])).toEqual([
            'begin',
            expect.stringMatching(/^declare entitykit_stream_\d+/),
            expect.stringMatching(/^fetch forward 1/),
            expect.stringMatching(/^close entitykit_stream_\d+$/),
            'select count(*) as count',
            'commit',
        ]);
        expect(release).toHaveBeenCalledWith(undefined);
    });

    it('classifies cursor failures as stream provider errors', async () => {
        const cause = Object.assign(new Error('cursor declaration failed'), {
            code: 'XX000',
        });
        const query = jest.fn(async (text: string) => {
            await Promise.resolve();
            if (text.startsWith('declare ')) {
                throw cause;
            }
            return { rows: [], rowCount: 0 };
        });
        const { connection, release } = postgresFixture(query);

        await expect(collect(connection.stream({
            text: 'select id from widgets',
            values: [],
        }))).rejects.toMatchObject({
            cause,
            code: 'XX000',
            operation: 'stream',
            provider: 'postgres',
        });
        expect(query.mock.calls.map(call => call[0])).toEqual([
            'begin read only',
            expect.stringMatching(/^declare entitykit_stream_\d+/),
            'rollback',
        ]);
        expect(release).toHaveBeenCalledWith(undefined);
    });

    it('resolves a deferred stream lease after its creating transaction ends', async () => {
        const query = jest.fn(async (text: string) => {
            await Promise.resolve();
            void text;
            return { rows: [], rowCount: 0 };
        });
        const { connection, release } = postgresFixture(query);
        let rows: AsyncIterable<Record<string, unknown>> | undefined;

        await connection.transaction(async () => {
            await Promise.resolve();
            rows = connection.stream({ text: 'select id from widgets', values: [] });
        });
        if (!rows) {
            throw new Error('Transaction did not create the deferred stream.');
        }
        await expect(collect(rows)).resolves.toEqual([]);

        expect(query.mock.calls.map(call => call[0])).toEqual([
            'begin',
            'commit',
            'begin read only',
            expect.stringMatching(/^declare entitykit_stream_\d+/),
            expect.stringMatching(/^fetch forward 100/),
            expect.stringMatching(/^close entitykit_stream_\d+$/),
            'commit',
        ]);
        expect(release).toHaveBeenCalledTimes(2);
    });
});
