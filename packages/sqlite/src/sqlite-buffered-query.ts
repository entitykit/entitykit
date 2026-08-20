import type { DatabaseSync } from 'node:sqlite';
import { OperationCanceledError } from '@entitykit/core';
import type { SqlStatement } from '@entitykit/core/adapter';
import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
} from '@entitykit/core/adapter';
import { throwIfOperationAborted } from '@entitykit/core/adapter';
import { sqliteError } from './sqlite-error';
import { executeStatement } from './sqlite-statement';

export async function executeSqliteBufferedQuery<
    TRow extends Record<string, unknown>,
>(
    database: DatabaseSync,
    statement: SqlStatement,
    options: DatabaseOperationOptions,
): Promise<DatabaseQueryResult<TRow>> {
    throwIfOperationAborted(options.signal);
    try {
        const result = await Promise.resolve(
            executeStatement<TRow>(database, statement),
        );
        throwIfOperationAborted(options.signal);
        return result;
    } catch (error) {
        if (error instanceof OperationCanceledError) {
            throw error;
        }
        throw sqliteError('query', error, statement);
    }
}
