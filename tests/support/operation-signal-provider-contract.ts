import { OperationCanceledError } from '../../packages/core/src';
import { withOperationSignal, type DatabaseConnection } from '../../packages/core/src/adapter';
import { requireDefined } from './require-defined';

const query = { text: 'select 42 as answer', values: [] };
const operations = ['query', 'transaction', 'stream', 'session'] as const;

export function defineOperationSignalProviderTests(createConnection: () => DatabaseConnection): void {
    it.each(operations)('refuses a root-canceled %s before provider work and preserves reuse', async operation => {
        const database = createConnection();
        const root = new AbortController();
        const reason = new Error('book lookup canceled');
        root.abort(reason);
        const connection = withOperationSignal(database, root.signal);
        const work = jest.fn(() => 42);
        try {
            const pending = operation === 'query' ? connection.query(query)
                : operation === 'transaction' ? connection.transaction(work)
                    : operation === 'session' ? connection.session?.(work)
                        : collectRows(requireDefined(connection.stream?.(query, { batchSize: 1 })));
            await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);
            await expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELED', cause: reason });
            expect(work).not.toHaveBeenCalled();
            expect(database.isInTransaction).toBe(false);
            expect((await database.query(query)).rows).toEqual([{ answer: 42 }]);
        } finally {
            await database.dispose?.();
        }
    });

    it.each(operations)('refuses an individually canceled %s when the wrapper signal remains live', async operation => {
        const database = createConnection();
        const root = new AbortController();
        const individual = new AbortController();
        const reason = new Error('individual book operation canceled');
        individual.abort(reason);
        const connection = withOperationSignal(database, root.signal);
        const options = Object.freeze({ signal: individual.signal });
        const work = jest.fn(() => 42);
        try {
            const pending = operation === 'query' ? connection.query(query, options)
                : operation === 'transaction' ? connection.transaction(work, options)
                    : operation === 'session' ? connection.session?.(work, options)
                        : collectRows(requireDefined(connection.stream?.(query, options)));
            await expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELED', cause: reason });
            expect(root.signal.aborted).toBe(false);
            expect(work).not.toHaveBeenCalled();
            expect(database.isInTransaction).toBe(false);
            expect((await database.query(query)).rows).toEqual([{ answer: 42 }]);
        } finally {
            await database.dispose?.();
        }
    });

    it.each(['root', 'individual'])('rolls back a checkout canceled by the %s signal before commit', async canceledBy => {
        const database = createConnection();
        const table = 'ek_signal_book_checkout';
        const root = new AbortController();
        const individual = new AbortController();
        const reason = new Error('checkout canceled before commit');
        const connection = withOperationSignal(database, root.signal);
        try {
            await database.query({ text: `drop table if exists ${table}`, values: [] });
            await database.query({ text: `create table ${table} (id int primary key)`, values: [] });
            await expect(connection.transaction(async () => {
                expect(connection.isInTransaction).toBe(true);
                await connection.query({ text: `insert into ${table} (id) values (1)`, values: [] });
                (canceledBy === 'root' ? root : individual).abort(reason);
            }, { signal: individual.signal })).rejects.toMatchObject({ code: 'OPERATION_CANCELED', cause: reason });
            expect(connection.isInTransaction).toBe(false);
            expect((await database.query({ text: `select id from ${table}`, values: [] })).rows).toEqual([]);
            expect((await database.query(query)).rows).toEqual([{ answer: 42 }]);
        } finally {
            try {
                await database.query({ text: `drop table if exists ${table}`, values: [] });
            } finally {
                await database.dispose?.();
            }
        }
    });
}

async function collectRows(rows: AsyncIterable<Record<string, unknown>>): Promise<unknown[]> {
    const result: unknown[] = [];
    for await (const row of rows) result.push(row);
    return result;
}
