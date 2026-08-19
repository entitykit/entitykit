import { OperationCanceledError } from '../../errors/runtime-errors';
import type { SqlStatement } from '../../sql/sql-statement';
import type { QueryStreamOptions } from '../../storage/database-connection';
import {
    isQueryAborted,
    queryStreamBatchSize,
    throwIfQueryAborted,
} from '../../storage/query-stream-options';
import { toMysqlBindValue } from './mysql-bind-value';
import type {
    MySqlConnection,
    MySqlStreamQuery,
    MySqlStreamQueryOptions,
} from './mysql-driver';
export async function* streamMysqlRows<TRow extends Record<string, unknown>>(
    connection: MySqlConnection,
    statement: SqlStatement,
    options: QueryStreamOptions,
    commandTimeoutMs: number | undefined,
    ownsConnection: boolean,
    state: { completed: boolean; destroyed: boolean },
): AsyncGenerator<TRow> {
    const batchSize = queryStreamBatchSize(options);
    throwIfQueryAborted(options.signal);
    const values = statement.values.map(toMysqlBindValue);
    const command: MySqlStreamQueryOptions = {
        sql: statement.text,
        values,
        timeout: commandTimeoutMs,
    };
    const query = connection.connection.query(command);
    const queryEnded = observeQueryEnd(query);
    const readable = query.stream({ highWaterMark: batchSize });
    const iterator = readable.iterator({ destroyOnReturn: false });
    const abort = (): void => {
        if (ownsConnection) {
            state.destroyed = true;
            connection.destroy();
        }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
        for await (const row of iterator) {
            throwIfQueryAborted(options.signal);
            yield row as TRow;
        }
        throwIfQueryAborted(options.signal);
        state.completed = true;
    } catch (error) {
        if (isQueryAborted(options.signal)) {
            throw new OperationCanceledError(options.signal?.reason);
        }
        throw error;
    } finally {
        options.signal?.removeEventListener('abort', abort);
        if (!ownsConnection && !state.completed) {
            readable.resume();
            await queryEnded;
        }
    }
}

async function observeQueryEnd(query: MySqlStreamQuery): Promise<void> {
    await new Promise<void>(resolve => {
        let settled = false;
        const done = (): void => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };
        query.once('end', done);
        query.once('error', done);
    });
}
