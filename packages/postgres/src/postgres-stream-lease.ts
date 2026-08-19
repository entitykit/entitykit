import { OperationCanceledError } from '../../errors/runtime-errors';
import type { SqlStatement } from '../../sql/sql-statement';
import type { QueryStreamOptions } from '../../storage/database-connection';
import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
} from '../../storage/database-errors';
import {
    queryStreamBatchSize,
    throwIfQueryAborted,
} from '../../storage/query-stream-options';
import type { PoolClient } from './postgres-driver';
import { createPostgresProviderError } from './postgres-provider-error';
import { streamPostgresRows } from './postgres-row-stream';

export async function* streamPostgresConnectionRows<
    TRow extends Record<string, unknown>,
>(
    statement: SqlStatement,
    options: QueryStreamOptions,
    activeClient: () => PoolClient | undefined,
    connect: () => Promise<PoolClient>,
    isInTransaction: () => boolean,
): AsyncGenerator<TRow> {
    queryStreamBatchSize(options);
    throwIfQueryAborted(options.signal);
    const currentClient = activeClient();
    const ownsClient = currentClient === undefined;
    const client = currentClient ?? await connect();
    const state = { released: false, safeToRelease: false };
    try {
        yield* streamPostgresRows<TRow>(
            client,
            statement,
            options,
            !isInTransaction(),
            state,
        );
    } catch (error) {
        if (
            error instanceof OperationCanceledError
            || error instanceof DatabaseTransactionCleanupError
            || error instanceof DatabaseProviderError
        ) {
            throw error;
        }
        throw createPostgresProviderError('stream', error, statement);
    } finally {
        if (ownsClient && !state.released) {
            client.release(state.safeToRelease ? undefined : true);
        }
    }
}
