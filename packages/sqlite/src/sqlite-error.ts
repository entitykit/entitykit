/**
 * Error mapping for the SQLite adapter.
 *
 * `node:sqlite` collapses every failure onto the single code
 * `ERR_SQLITE_ERROR`, which says nothing about what went wrong. This module
 * mines the extended result code and the message for the constraint, table and
 * column so failures classify into the same typed errors as Postgres. It is a
 * standalone module because connect, statement execution, transaction cleanup
 * and dispose all need it.
 */
import type { SqlStatement } from '@entitykit/core/adapter';
import { DatabaseProviderError, type DatabaseProviderOperation } from '@entitykit/core/adapter';

/**
 * SQLite reports constraint failures through an extended result code and a
 * message naming the table and column, for example
 * `UNIQUE constraint failed: users.email`. Both are surfaced so failures
 * classify into the same typed errors as Postgres — `error.code` on a plain
 * `node:sqlite` error is only ever `ERR_SQLITE_ERROR`, which says nothing about
 * what went wrong.
 */
export function sqliteError(operation: DatabaseProviderOperation, cause: unknown, statement?: SqlStatement): DatabaseProviderError {
    if (cause instanceof DatabaseProviderError) {
        return cause;
    }
    const record = cause && typeof cause === 'object'
        ? cause as { code?: unknown; errcode?: unknown; message?: unknown }
        : {};
    const extendedCode = typeof record.errcode === 'number' ? String(record.errcode) : undefined;
    const code = extendedCode ?? (typeof record.code === 'string' ? record.code : undefined);
    const message = typeof record.message === 'string' ? record.message : undefined;
    const target = message ? /constraint failed:\s*([\w.]+)/i.exec(message)?.[1] : undefined;
    const [table, column] = target ? target.split('.') : [];

    const summary = `SQLite ${operation} failed${code ? ` (${code})` : ''}.`;
    return new DatabaseProviderError(message ? `${summary} ${message}` : summary, cause, {
        provider: 'sqlite',
        operation,
        statement,
        code,
        constraint: target,
        table,
        column,
        detail: message,
    });
}
