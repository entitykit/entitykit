import { withOperationSignal } from '../packages/core/src/adapter';
import type { DatabaseConnection, QueryStreamOptions, TransactionOptions } from '../packages/core/src/adapter';
import { RecordingDatabaseConnection } from '../packages/testing/src';
import { requireDefined } from './support/require-defined';

const statement = { text: 'select id from books', values: [] };
const operations = ['query', 'transaction', 'stream', 'session'] as const;
type Operation = typeof operations[number];
type Options = TransactionOptions & QueryStreamOptions;

async function perform(connection: DatabaseConnection, operation: Operation, options?: Options): Promise<unknown> {
    switch (operation) {
        case 'query': return await connection.query(statement, options);
        case 'transaction': return await connection.transaction(() => 'checkout committed', options);
        case 'session': return await connection.session?.(() => 'session result', options);
        case 'stream': {
            const rows: Array<Record<string, unknown>> = [];
            for await (const row of requireDefined(connection.stream?.(statement, options))) rows.push(row);
            return rows;
        }
    }
}

describe('operation signal connection wrapper', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns the original connection when no signal is supplied', () => {
        const database = new RecordingDatabaseConnection();
        expect(withOperationSignal(database, undefined)).toBe(database);
    });

    it('preserves absent optional capabilities', () => {
        const database: DatabaseConnection = {
            isInTransaction: false,
            async query() {
                return await Promise.resolve({ rows: [], rowCount: 0 });
            },
            async transaction(work) {
                return await work();
            },
        };
        const connection = withOperationSignal(database, new AbortController().signal);
        expect('stream' in connection).toBe(false);
        expect('session' in connection).toBe(false);
        expect('dispose' in connection).toBe(false);
    });

    it.each(operations)('forwards %s arguments, receiver, options and return value', async operation => {
        const database = new RecordingDatabaseConnection();
        database.queueResult({ rows: [{ id: 42 }], rowCount: 1 });
        const provider = jest.spyOn(database, operation);
        const signal = new AbortController().signal;
        const options = Object.freeze({ isolationLevel: 'serializable' as const, readOnly: true, batchSize: 2 });
        const result = await perform(withOperationSignal(database, signal), operation, options);
        expect(provider.mock.contexts).toEqual([database]);
        const forwarded = provider.mock.calls[0];
        expect(forwarded[1]).toEqual({ ...options, signal });
        expect(forwarded[1]).not.toBe(options);
        expect(options).toEqual({ isolationLevel: 'serializable', readOnly: true, batchSize: 2 });
        if (operation === 'query' || operation === 'stream') expect(forwarded[0]).toBe(statement);
        expect(result).toEqual(operation === 'query' ? { rows: [{ id: 42 }], rowCount: 1 }
            : operation === 'stream' ? [{ id: 42 }]
                : operation === 'transaction' ? 'checkout committed' : 'session result');
    });

    it.each(operations)('keeps an identical %s signal without composing it', async operation => {
        const database = new RecordingDatabaseConnection();
        const signal = new AbortController().signal;
        const any = jest.spyOn(AbortSignal, 'any');
        const provider = jest.spyOn(database, operation);
        await perform(withOperationSignal(database, signal), operation, { signal });
        expect(provider.mock.calls[0][1]?.signal).toBe(signal);
        expect(any).not.toHaveBeenCalled();
    });

    it.each(operations)('composes distinct signals for %s and retains options', async operation => {
        const database = new RecordingDatabaseConnection();
        const root = new AbortController();
        const individual = new AbortController();
        const provider = jest.spyOn(database, operation);
        const options = Object.freeze({ signal: individual.signal, batchSize: 2, readOnly: true });
        await perform(withOperationSignal(database, root.signal), operation, options);
        const forwarded = provider.mock.calls[0][1];
        expect(forwarded).toMatchObject({ batchSize: 2, readOnly: true });
        const signal = requireDefined(forwarded?.signal);
        expect(signal).not.toBe(root.signal);
        expect(signal).not.toBe(individual.signal);
        expect(signal.aborted).toBe(false);
        const reason = new Error('cancel checkout');
        root.abort(reason);
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toBe(reason);
        expect(options.signal).toBe(individual.signal);
        expect(individual.signal.aborted).toBe(false);
    });

    it('also observes cancellation from an individual operation', async () => {
        const database = new RecordingDatabaseConnection();
        const root = new AbortController();
        const individual = new AbortController();
        const provider = jest.spyOn(database, 'query');
        await withOperationSignal(database, root.signal).query(statement, { signal: individual.signal });
        const signal = requireDefined(provider.mock.calls[0][1]?.signal);
        const reason = new Error('cancel book lookup');
        individual.abort(reason);
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toBe(reason);
        expect(root.signal.aborted).toBe(false);
    });

    it('reads the current provider transaction state', async () => {
        const database = new RecordingDatabaseConnection();
        const connection = withOperationSignal(database, new AbortController().signal);
        expect(connection.isInTransaction).toBe(false);
        await connection.transaction(() => {
            expect(connection.isInTransaction).toBe(true);
        });
        expect(connection.isInTransaction).toBe(false);
    });

    it('forwards disposal once with the provider receiver and failure identity', async () => {
        const failure = new Error('provider cleanup failed');
        const database = Object.assign(new RecordingDatabaseConnection(), {
            dispose: jest.fn(async (): Promise<void> => {
                await Promise.resolve();
                throw failure;
            }),
        });
        const connection = withOperationSignal(database, new AbortController().signal);
        await expect(connection.dispose?.()).rejects.toBe(failure);
        expect(database.dispose).toHaveBeenCalledTimes(1);
        expect(database.dispose.mock.contexts).toEqual([database]);
    });
});
