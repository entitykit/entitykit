/**
 * Statement-execution core for the SQLite adapter.
 *
 * This is the seam between a driver-agnostic `SqlStatement` and `node:sqlite`.
 * It has to work around two sharp edges of `DatabaseSync`: `prepare()` compiles
 * only the first statement of a multi-statement string (so schema scripts must
 * route to `exec`), and it offers no way to ask a compiled statement whether it
 * yields rows, so the SQL text is classified up front to choose `all()` vs
 * `run()`. Binding and error mapping are delegated to their own modules.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { SqlStatement } from '@entitykit/core/adapter';
import type { DatabaseQueryResult } from '@entitykit/core/adapter';
import { toBindValue } from './sqlite-binding';
import { sqliteError } from './sqlite-error';

const RETURNS_ROWS = /^\s*(select|with|values|pragma|explain)\b/i;
const HAS_RETURNING = /\breturning\b/i;

/**
 * Whether `sql` holds more than one statement.
 *
 * `DatabaseSync.prepare()` compiles only the first statement of a multi-statement
 * string and silently discards the rest, so scripts such as
 * `DbContext.createSchemaScript()` would create only their first table. Quotes
 * and comments are tracked so a semicolon inside a literal is not mistaken for
 * a separator.
 */
export function hasMultipleStatements(sql: string): boolean {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < sql.length; index++) {
        const character = sql[index];
        const next = sql[index + 1];

        if (inLineComment) {
            if (character === '\n') {
                inLineComment = false;
            }
            continue;
        }
        if (inBlockComment) {
            if (character === '*' && next === '/') {
                inBlockComment = false;
                index++;
            }
            continue;
        }
        if (inSingleQuote || inDoubleQuote) {
            const quote = inSingleQuote ? '\'' : '"';
            if (character === quote) {
                if (next === quote) {
                    index++;
                } else if (inSingleQuote) {
                    inSingleQuote = false;
                } else {
                    inDoubleQuote = false;
                }
            }
            continue;
        }

        if (character === '\'') {
            inSingleQuote = true;
        } else if (character === '"') {
            inDoubleQuote = true;
        } else if (character === '-' && next === '-') {
            inLineComment = true;
            index++;
        } else if (character === '/' && next === '*') {
            inBlockComment = true;
            index++;
        } else if (character === ';' && sql.slice(index + 1).trim().length > 0) {
            return true;
        }
    }

    return false;
}

/**
 * Run one `SqlStatement` against `db` and map the driver result onto a
 * `DatabaseQueryResult`. Multi-statement scripts (only ever parameterless
 * schema DDL) run through `exec`; single statements are prepared, bound and
 * executed with `all()` or `run()` according to whether they return rows.
 */
export function executeStatement<TRow extends Record<string, unknown> = Record<string, unknown>>(
    db: DatabaseSync,
    statement: SqlStatement,
): DatabaseQueryResult<TRow> {
    if (hasMultipleStatements(statement.text)) {
        if (statement.values.length > 0) {
            // Parameters bind to a single statement, so this is always a mistake
            // rather than something to run silently.
            throw new Error('SQLite cannot run a multi-statement script with bound parameters. Execute one statement at a time.');
        }

        try {
            // `exec` runs every statement; `prepare` would run only the first.
            db.exec(statement.text);
            return { rows: [], rowCount: 0 };
        } catch (error) {
            throw sqliteError('query', error, statement);
        }
    }

    try {
        const prepared = db.prepare(statement.text);
        const params = statement.values.map(toBindValue);

        if (RETURNS_ROWS.test(statement.text) || HAS_RETURNING.test(statement.text)) {
            const rows = prepared.all(...params) as TRow[];
            return { rows, rowCount: rows.length };
        }

        const info = prepared.run(...params);
        return { rows: [], rowCount: Number(info.changes) };
    } catch (error) {
        throw sqliteError('query', error, statement);
    }
}

/** Prepare one row-returning statement and expose SQLite's lazy row iterator. */
export function iterateStatement<TRow extends Record<string, unknown> = Record<string, unknown>>(
    db: DatabaseSync,
    statement: SqlStatement,
): IterableIterator<TRow> {
    if (hasMultipleStatements(statement.text)) {
        throw new Error('SQLite streaming requires exactly one row-returning statement.');
    }
    const prepared = db.prepare(statement.text);
    const params = statement.values.map(toBindValue);
    return prepared.iterate(...params) as IterableIterator<TRow>;
}
