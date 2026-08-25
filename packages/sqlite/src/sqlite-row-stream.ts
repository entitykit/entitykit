import type { SqlStatement } from '@entitykit/core/adapter';
import { throwIfQueryAborted } from '@entitykit/core/adapter';
import { iterateStatement } from './sqlite-statement';

type SqliteDatabase = Parameters<typeof iterateStatement>[0];

/** Advance SQLite's synchronous iterator with cancellation and owner retention. */
export function* streamSqliteRows<TRow extends Record<string, unknown>>(
    database: SqliteDatabase,
    statement: SqlStatement,
    signal?: AbortSignal,
): Generator<TRow> {
    const statementRows = iterateStatement<TRow>(database, statement);
    let completed = false;
    try {
        // Check around every native step: it can compute values synchronously.
        throwIfQueryAborted(signal);
        let next = statementRows.iterator.next();
        throwIfQueryAborted(signal);
        while (!next.done) {
            yield next.value;
            throwIfQueryAborted(signal);
            next = statementRows.iterator.next();
            throwIfQueryAborted(signal);
        }
        completed = true;
    } finally {
        if (!completed) {
            statementRows.iterator.return?.();
        }
    }
}
