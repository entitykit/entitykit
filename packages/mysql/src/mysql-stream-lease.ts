import { OperationCanceledError } from '@entitykit/core';
import type { SqlStatement } from '@entitykit/core/adapter';
import type { QueryStreamOptions } from '@entitykit/core/adapter';
import {
    queryStreamBatchSize,
    throwIfQueryAborted,
} from '@entitykit/core/adapter';
import type { MySqlConnection } from './mysql-driver';
import { createMysqlProviderError } from './mysql-provider-error';
import { streamMysqlRows } from './mysql-row-stream';

export async function* streamMysqlConnectionRows<
    TRow extends Record<string, unknown>,
>(
    statement: SqlStatement,
    options: QueryStreamOptions,
    activeConnection: () => MySqlConnection | undefined,
    connect: () => Promise<MySqlConnection>,
    commandTimeoutMs: number | undefined,
): AsyncGenerator<TRow> {
    queryStreamBatchSize(options);
    throwIfQueryAborted(options.signal);
    const currentConnection = activeConnection();
    const ownsConnection = currentConnection === undefined;
    const connection = currentConnection ?? await connect();
    const state = { completed: false, destroyed: false };
    try {
        yield* streamMysqlRows<TRow>(
            connection,
            statement,
            options,
            commandTimeoutMs,
            ownsConnection,
            state,
        );
    } catch (error) {
        if (error instanceof OperationCanceledError) {
            throw error;
        }
        throw createMysqlProviderError('stream', error, statement);
    } finally {
        if (ownsConnection) {
            if (state.completed) {
                connection.release();
            } else if (!state.destroyed) {
                connection.destroy();
            }
        }
    }
}
