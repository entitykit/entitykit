import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { OperationCanceledError } from '../packages/core/src';
import { MySqlPooledConnection } from '../packages/mysql/src/mysql-pooled-connection';
import type {
    MySqlConnection,
    MySqlPool,
    MySqlStreamQuery,
} from '../packages/mysql/src/mysql-driver';

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows) {
        values.push(row);
    }
    return values;
}

function failedReadable(error: Error): Readable {
    const readable = new Readable({
        objectMode: true,
        read: () => readable.destroy(error),
    });
    return readable;
}

function mysqlRowQuery(rows: ReadonlyArray<Record<string, unknown>>): {
    readonly query: MySqlStreamQuery;
    readonly stream: jest.Mock;
} {
    const emitter = new EventEmitter();
    const stream = jest.fn(() => {
        const readable = Readable.from(rows, { objectMode: true });
        readable.once('end', () => emitter.emit('end'));
        readable.once('error', error => emitter.emit('error', error));
        return readable;
    });
    return { query: Object.assign(emitter, { stream }), stream };
}

function mysqlFixture(rows: ReadonlyArray<Record<string, unknown>>): {
    readonly connection: MySqlPooledConnection;
    readonly callbackQuery: jest.Mock;
    readonly commandQuery: jest.Mock;
    readonly destroy: jest.Mock;
    readonly getConnection: jest.Mock;
    readonly release: jest.Mock;
    readonly rowStream: jest.Mock;
} {
    const streamed = mysqlRowQuery(rows);
    const callbackQuery = jest.fn(() => streamed.query);
    const release = jest.fn();
    const destroy = jest.fn();
    const commandQuery = jest.fn().mockResolvedValue([[], []]);
    const client: MySqlConnection = {
        query: commandQuery,
        connection: { query: callbackQuery },
        release,
        destroy,
    };
    const getConnection = jest.fn().mockResolvedValue(client);
    const pool: MySqlPool = {
        query: jest.fn(),
        getConnection,
        end: jest.fn(),
    };
    return {
        connection: new MySqlPooledConnection(pool, 5000),
        callbackQuery,
        commandQuery,
        destroy,
        getConnection,
        release,
        rowStream: streamed.stream,
    };
}

describe('MySQL query streaming', () => {
    it('uses driver backpressure and releases a completed lease', async () => {
        const { connection, callbackQuery, destroy, release, rowStream } = mysqlFixture([
            { id: 1 },
            { id: 2 },
        ]);

        await expect(collect(connection.stream(
            { text: 'select id from widgets where tenant_id = ?', values: ['tenant_1'] },
            { batchSize: 2 },
        ))).resolves.toEqual([{ id: 1 }, { id: 2 }]);

        expect(callbackQuery).toHaveBeenCalledWith({
            sql: 'select id from widgets where tenant_id = ?',
            values: ['tenant_1'],
            timeout: 5000,
        });
        expect(rowStream).toHaveBeenCalledWith({ highWaterMark: 2 });
        expect(release).toHaveBeenCalledTimes(1);
        expect(destroy).not.toHaveBeenCalled();
    });

    it('cancels iteration by destroying its owned lease exactly once', async () => {
        const { connection, destroy, release } = mysqlFixture([{ id: 1 }, { id: 2 }]);
        const controller = new AbortController();
        const iterator = connection.stream(
            { text: 'select id from widgets', values: [] },
            { batchSize: 1, signal: controller.signal },
        )[Symbol.asyncIterator]();

        await expect(iterator.next()).resolves.toEqual({ done: false, value: { id: 1 } });
        controller.abort('stop stream');
        await expect(iterator.next()).rejects.toBeInstanceOf(OperationCanceledError);

        expect(destroy).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
    });

    it('drains a canceled row stream before reusing an explicit transaction', async () => {
        const { connection, commandQuery, destroy, release } = mysqlFixture([
            { id: 1 },
            { id: 2 },
        ]);
        commandQuery.mockImplementation(async (command: { sql?: string } | string) => {
            await Promise.resolve();
            const sql = typeof command === 'string' ? command : command.sql;
            return sql === 'select count(*) as count'
                ? [[{ count: 2 }], []]
                : [[], []];
        });

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

        expect(destroy).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
        expect(commandQuery).toHaveBeenNthCalledWith(1, {
            sql: 'begin', timeout: 5000, values: [],
        });
        expect(commandQuery).toHaveBeenNthCalledWith(2, {
            sql: 'select count(*) as count', timeout: 5000, values: [],
        });
        expect(commandQuery).toHaveBeenNthCalledWith(3, {
            sql: 'commit', timeout: 5000, values: [],
        });
    });

    it('classifies row-stream failures and destroys the owned lease', async () => {
        const cause = Object.assign(new Error('row stream failed'), {
            code: 'ER_QUERY_INTERRUPTED',
        });
        const { connection, destroy, release, rowStream } = mysqlFixture([]);
        rowStream.mockImplementationOnce(() => failedReadable(cause));

        await expect(collect(connection.stream({
            text: 'select id from widgets',
            values: [],
        }))).rejects.toMatchObject({
            cause,
            code: 'ER_QUERY_INTERRUPTED',
            operation: 'stream',
            provider: 'mysql',
        });
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
    });

    it('resolves a deferred stream lease after its creating transaction ends', async () => {
        const { connection, commandQuery, release } = mysqlFixture([{ id: 1 }]);
        let rows: AsyncIterable<Record<string, unknown>> | undefined;

        await connection.transaction(async () => {
            await Promise.resolve();
            rows = connection.stream({ text: 'select id from widgets', values: [] });
        });
        if (!rows) {
            throw new Error('Transaction did not create the deferred stream.');
        }
        await expect(collect(rows)).resolves.toEqual([{ id: 1 }]);

        expect(commandQuery).toHaveBeenNthCalledWith(1, {
            sql: 'begin', timeout: 5000, values: [],
        });
        expect(commandQuery).toHaveBeenNthCalledWith(2, {
            sql: 'commit', timeout: 5000, values: [],
        });
        expect(release).toHaveBeenCalledTimes(2);
    });

    it('does not start a deferred stream after commit outcome becomes unknown', async () => {
        const commitFailure = Object.assign(
            new Error('commit acknowledgement lost'),
            { code: 'PROTOCOL_CONNECTION_LOST' },
        );
        const { connection, commandQuery, getConnection } = mysqlFixture([]);
        commandQuery.mockImplementation(
            async (command: { sql?: string } | string) => {
                await Promise.resolve();
                const sql = typeof command === 'string' ? command : command.sql;
                if (sql === 'commit') {
                    throw commitFailure;
                }
                return [[], []];
            },
        );
        const rows = connection.stream({
            text: 'select id from widgets',
            values: [],
        });

        let failure: unknown;
        try {
            await connection.transaction(() => undefined);
        } catch (error) {
            failure = error;
        }

        expect(failure).toMatchObject({
            name: 'TransactionOutcomeUnknownError',
            provider: 'mysql',
        });
        await expect(collect(rows)).rejects.toBe(failure);
        expect(getConnection).toHaveBeenCalledTimes(1);
        expect(commandQuery).toHaveBeenNthCalledWith(1, {
            sql: 'begin', timeout: 5000, values: [],
        });
        expect(commandQuery).toHaveBeenNthCalledWith(2, {
            sql: 'commit', timeout: 5000, values: [],
        });
        expect(commandQuery).toHaveBeenNthCalledWith(3, {
            sql: 'rollback', timeout: 5000, values: [],
        });
    });
});
