import { OperationCanceledError } from '@entitykit/core';
import type { SqlStatement } from '@entitykit/core/adapter';
import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
} from '@entitykit/core/adapter';
import {
    awaitWithOperationCancellation,
    isOperationAborted,
    throwIfOperationAborted,
} from '@entitykit/core/adapter';
import type { Pool, PoolClient } from './postgres-driver';
import { createPostgresProviderError } from './postgres-provider-error';

export async function executePostgresBufferedQuery<
    TRow extends Record<string, unknown>,
>(
    pool: Pool,
    activeClient: PoolClient | undefined,
    connect: () => Promise<PoolClient>,
    statement: SqlStatement,
    options: DatabaseOperationOptions,
): Promise<DatabaseQueryResult<TRow>> {
    throwIfOperationAborted(options.signal);
    if (activeClient) {
        return runQuery(activeClient, statement, options);
    }
    if (!options.signal) {
        return runQuery(pool, statement, options);
    }

    const client = await connect();
    const state = { destroyed: false };
    const abort = (): void => {
        state.destroyed = true;
        try {
            client.release(true);
        } catch {
            // A concurrent driver failure may have released it first.
        }
    };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
        return await awaitWithOperationCancellation(
            runQuery(client, statement, options),
            options.signal,
        );
    } finally {
        options.signal.removeEventListener('abort', abort);
        if (!state.destroyed) {
            client.release();
        }
    }
}

async function runQuery<TRow extends Record<string, unknown>>(
    target: Pick<PoolClient, 'query'>,
    statement: SqlStatement,
    options: DatabaseOperationOptions,
): Promise<DatabaseQueryResult<TRow>> {
    try {
        throwIfOperationAborted(options.signal);
        const result = await target.query<TRow>(
            statement.text,
            [...statement.values],
        );
        throwIfOperationAborted(options.signal);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    } catch (error) {
        if (isOperationAborted(options.signal)) {
            throw new OperationCanceledError(options.signal?.reason);
        }
        throw createPostgresProviderError('query', error, statement);
    }
}
