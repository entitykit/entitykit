import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
    type DatabaseProviderOperation,
} from '../../storage/database-errors';
import type { MySqlConnection, MySqlQueryOptions } from './mysql-driver';
import { createMysqlProviderError } from './mysql-provider-error';
import type {
    TransactionIsolationLevel,
    TransactionOptions,
} from '../../storage/database-connection';
import { throwIfOperationAborted } from '../../storage/operation-cancellation';
import { TransactionOutcomeUnknownError } from '../../storage/transaction-outcome-unknown-error';

export async function runMysqlTransaction<TResult>(
    connection: MySqlConnection,
    work: () => TResult | Promise<TResult>,
    options?: TransactionOptions,
    commandTimeoutMs?: number,
): Promise<TResult> {
    throwIfOperationAborted(options?.signal);
    if (options?.isolationLevel) {
        await exec(
            connection,
            `set transaction isolation level ${mysqlIsolationLevel(options.isolationLevel)}`,
            'begin',
            commandTimeoutMs,
        );
        throwIfOperationAborted(options.signal);
    }
    const access = options?.readOnly === undefined
        ? undefined
        : options.readOnly ? 'read only' : 'read write';
    await exec(
        connection,
        access ? `start transaction ${access}` : 'begin',
        'begin',
        commandTimeoutMs,
    );
    try {
        throwIfOperationAborted(options?.signal);
        const result = await work();
        throwIfOperationAborted(options?.signal);
        try {
            await exec(connection, 'commit', 'commit', commandTimeoutMs);
        } catch (error) {
            if (
                error instanceof DatabaseProviderError &&
                isUnknownMysqlCommitOutcome(error.code)
            ) {
                throw new TransactionOutcomeUnknownError('mysql', error);
            }
            throw error;
        }
        return result;
    } catch (error) {
        try {
            await exec(connection, 'rollback', 'rollback', commandTimeoutMs);
        } catch (rollbackError) {
            throw new DatabaseTransactionCleanupError(
                'mysql',
                error,
                rollbackError instanceof DatabaseProviderError
                    ? rollbackError
                    : createMysqlProviderError('rollback', rollbackError),
            );
        }
        throw error;
    }
}

function isUnknownMysqlCommitOutcome(code?: string): boolean {
    return code !== undefined && [
        'ER_SERVER_SHUTDOWN',
        'PROTOCOL_CONNECTION_LOST',
        'ECONNRESET',
        'ECONNREFUSED',
        'EPIPE',
        'ETIMEDOUT',
    ].includes(code);
}

function mysqlIsolationLevel(level: TransactionIsolationLevel): string {
    const levels: Record<TransactionIsolationLevel, string> = {
        readUncommitted: 'read uncommitted',
        readCommitted: 'read committed',
        repeatableRead: 'repeatable read',
        serializable: 'serializable',
    };
    return levels[level];
}

export async function runMysqlSavepoint<TResult>(
    connection: MySqlConnection,
    depth: number,
    work: () => TResult | Promise<TResult>,
    options?: TransactionOptions,
    commandTimeoutMs?: number,
    onRollbackToSavepoint?: (error: unknown) => void,
): Promise<TResult> {
    throwIfOperationAborted(options?.signal);
    const savepoint = `entitykit_sp_${String(depth)}`;
    await exec(connection, `savepoint ${savepoint}`, 'savepoint', commandTimeoutMs);
    try {
        throwIfOperationAborted(options?.signal);
        const result = await work();
        throwIfOperationAborted(options?.signal);
        await exec(
            connection,
            `release savepoint ${savepoint}`,
            'releaseSavepoint',
            commandTimeoutMs,
        );
        return result;
    } catch (error) {
        try {
            await exec(
                connection,
                `rollback to savepoint ${savepoint}`,
                'rollbackToSavepoint',
                commandTimeoutMs,
            );
            onRollbackToSavepoint?.(error);
        } catch (rollbackError) {
            throw new DatabaseTransactionCleanupError(
                'mysql',
                error,
                rollbackError instanceof DatabaseProviderError
                    ? rollbackError
                    : createMysqlProviderError('rollbackToSavepoint', rollbackError),
            );
        }
        throw error;
    }
}

async function exec(
    connection: MySqlConnection,
    sql: string,
    operation: DatabaseProviderOperation,
    commandTimeoutMs?: number,
): Promise<void> {
    try {
        if (commandTimeoutMs === undefined) {
            await connection.query(sql, []);
        } else {
            const command: MySqlQueryOptions = {
                sql,
                values: [],
                timeout: commandTimeoutMs,
            };
            await connection.query(command);
        }
    } catch (error) {
        throw createMysqlProviderError(operation, error);
    }
}
