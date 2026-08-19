import { OperationCanceledError } from '../../errors/runtime-errors';
import type { SqlStatement } from '../../sql/sql-statement';
import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
} from '../../storage/database-connection';
import {
    awaitWithOperationCancellation,
    isOperationAborted,
    throwIfOperationAborted,
} from '../../storage/operation-cancellation';
import type { MySqlConnection, MySqlPool } from './mysql-driver';
import { executeMysqlQuery } from './mysql-query-executor';

export async function executeMysqlBufferedQuery<
    TRow extends Record<string, unknown>,
>(
    pool: MySqlPool,
    activeConnection: MySqlConnection | undefined,
    connect: () => Promise<MySqlConnection>,
    statement: SqlStatement,
    commandTimeoutMs: number | undefined,
    options: DatabaseOperationOptions,
): Promise<DatabaseQueryResult<TRow>> {
    throwIfOperationAborted(options.signal);
    if (activeConnection) {
        return runQuery(activeConnection, statement, commandTimeoutMs, options);
    }
    if (!options.signal) {
        return runQuery(pool, statement, commandTimeoutMs, options);
    }

    const connection = await connect();
    const state = { destroyed: false };
    const abort = (): void => {
        state.destroyed = true;
        try {
            connection.destroy();
        } catch {
            // A concurrent driver failure may have destroyed it first.
        }
    };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
        return await awaitWithOperationCancellation(
            runQuery(connection, statement, commandTimeoutMs, options),
            options.signal,
        );
    } finally {
        options.signal.removeEventListener('abort', abort);
        if (!state.destroyed) {
            connection.release();
        }
    }
}

async function runQuery<TRow extends Record<string, unknown>>(
    target: MySqlConnection | MySqlPool,
    statement: SqlStatement,
    commandTimeoutMs: number | undefined,
    options: DatabaseOperationOptions,
): Promise<DatabaseQueryResult<TRow>> {
    try {
        throwIfOperationAborted(options.signal);
        const result = await executeMysqlQuery<TRow>(
            target,
            statement,
            commandTimeoutMs,
        );
        throwIfOperationAborted(options.signal);
        return result;
    } catch (error) {
        if (isOperationAborted(options.signal)) {
            throw new OperationCanceledError(options.signal?.reason);
        }
        throw error;
    }
}
