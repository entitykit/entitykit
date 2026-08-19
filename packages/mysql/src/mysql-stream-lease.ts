import { OperationCanceledError } from '../../errors/runtime-errors';
import type { SqlStatement } from '../../sql/sql-statement';
import type { QueryStreamOptions } from '../../storage/database-connection';
import {
    queryStreamBatchSize,
    throwIfQueryAborted,
} from '../../storage/query-stream-options';
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
