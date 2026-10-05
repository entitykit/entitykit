import { DatabaseSync } from 'node:sqlite';
import { OperationCanceledError } from '../packages/core/src';
import type { SqlStatement } from '../packages/core/src';
import { streamSqliteRows } from '../packages/sqlite/src/sqlite-row-stream';

type NativeIterator = ReturnType<ReturnType<DatabaseSync['prepare']>['iterate']>;
type NativeStep = ReturnType<NativeIterator['next']>;

describe('SQLite native stream iterator lifetime', () => {
    it('closes the native cursor immediately on early consumer return', () => {
        const fixture = openIterator();
        try {
            for (const row of streamSqliteRows(fixture.database, fixture.statement)) {
                expect(row.n).toBe(1);
                break;
            }
            expect(fixture.close).toHaveBeenCalledTimes(1);
        } finally {
            fixture.cleanup();
        }
    });

    it('closes after cancellation and leaves a normally exhausted cursor alone', () => {
        const fixture = openIterator();
        const controller = new AbortController();
        try {
            const rows = streamSqliteRows(fixture.database, fixture.statement, controller.signal);
            expect(rows.next().value).toEqual({ n: 1 });
            controller.abort();
            expect(() => rows.next()).toThrow(OperationCanceledError);
            expect(fixture.close).toHaveBeenCalledTimes(1);
        } finally {
            fixture.cleanup();
        }

        const completed = openIterator();
        try {
            expect([...streamSqliteRows(completed.database, completed.statement)])
                .toEqual([{ n: 1 }, { n: 2 }]);
            expect(completed.close).not.toHaveBeenCalled();
        } finally {
            completed.cleanup();
        }
    });

    it('supports an iterator without an optional return method', () => {
        const fixture = openIterator(false);
        try {
            const rows = streamSqliteRows(fixture.database, fixture.statement);
            expect(rows.next().value).toEqual({ n: 1 });
            expect(() => rows.return(undefined)).not.toThrow();
        } finally {
            fixture.cleanup();
        }
    });

    it.each([1, 2])('refuses a row when native step %i aborts synchronously', stopAt => {
        const database = new DatabaseSync(':memory:');
        const controller = new AbortController();
        database.function('maybe_abort', value => {
            if (value === stopAt) controller.abort('native step cancellation');
            return value;
        });
        const consumed: number[] = [];
        try {
            expect(() => {
                for (const row of streamSqliteRows<{ n: number }>(database, {
                    text: 'select maybe_abort(1) as n union all select maybe_abort(2)', values: [],
                }, controller.signal)) consumed.push(row.n);
            }).toThrow(OperationCanceledError);
            expect(consumed).toEqual(stopAt === 1 ? [] : [1]);
        } finally {
            database.close();
        }
    });
});

function openIterator(supportsReturn = true): {
    database: DatabaseSync;
    statement: SqlStatement;
    close: jest.Mock<NativeStep, []>;
    cleanup: () => void;
} {
    const database = new DatabaseSync(':memory:');
    const statement = { text: 'select 1 as n union all select 2 as n', values: [] };
    const prepared = database.prepare(statement.text);
    const nativeRows = prepared.iterate();
    const close = jest.fn((): NativeStep => nativeRows.return?.() ?? { done: true, value: undefined });
    const iterator: NativeIterator = {
        next: () => nativeRows.next(),
        ...supportsReturn ? { return: close } : {},
        [Symbol.iterator](): NativeIterator {
            return this;
        },
        [Symbol.dispose](): void {
            nativeRows.return?.();
        },
    };
    jest.spyOn(prepared, 'iterate').mockReturnValue(iterator);
    jest.spyOn(database, 'prepare').mockReturnValue(prepared);
    return { database, statement, close, cleanup: (): void => {
        jest.restoreAllMocks();
        nativeRows.return?.();
        database.close();
    } };
}
