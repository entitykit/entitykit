import { OperationCanceledError } from '@entitykit/core';
import type { SqlStatement } from '@entitykit/core/adapter';
import type { QueryStreamOptions } from '@entitykit/core/adapter';
import { DatabaseTransactionCleanupError } from '@entitykit/core/adapter';
import {
    queryStreamBatchSize,
    throwIfQueryAborted,
} from '@entitykit/core/adapter';
import type { PoolClient } from './postgres-driver';
import { createPostgresProviderError } from './postgres-provider-error';

let nextCursorId = 1;

export async function* streamPostgresRows<TRow extends Record<string, unknown>>(
    client: PoolClient,
    statement: SqlStatement,
    options: QueryStreamOptions,
    ownsTransaction: boolean,
    state: { released: boolean; safeToRelease: boolean },
): AsyncGenerator<TRow> {
    const batchSize = queryStreamBatchSize(options);
    throwIfQueryAborted(options.signal);
    const cursorName = `entitykit_stream_${String(nextCursorId++)}`;
    let transactionStarted = false;
    let cursorDeclared = false;
    let primaryError: unknown;
    const abort = (): void => {
        if (ownsTransaction && !state.released) {
            state.released = true;
            try {
                client.release(true);
            } catch {
                // A concurrent driver failure may have released it first.
            }
        }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
        if (ownsTransaction) {
            await client.query('begin read only');
            transactionStarted = true;
        }
        await client.query(
            `declare ${cursorName} no scroll cursor for ${statement.text}`,
            [...statement.values],
        );
        cursorDeclared = true;

        let hasRows = true;
        while (hasRows) {
            throwIfQueryAborted(options.signal);
            const result = await client.query<TRow>(
                `fetch forward ${String(batchSize)} from ${cursorName}`,
            );
            throwIfQueryAborted(options.signal);
            if (result.rows.length === 0) {
                hasRows = false;
                continue;
            }
            for (const row of result.rows) {
                throwIfQueryAborted(options.signal);
                yield row;
            }
        }
    } catch (error) {
        primaryError = options.signal?.aborted === true
            ? new OperationCanceledError(options.signal.reason)
            : error;
        throw primaryError;
    } finally {
        options.signal?.removeEventListener('abort', abort);
        await cleanupPostgresStream(client, statement, cursorName, {
            cursorDeclared,
            ownsTransaction,
            primaryError,
            state,
            transactionStarted,
        });
    }
}

interface PostgresStreamCleanupState {
    readonly cursorDeclared: boolean;
    readonly ownsTransaction: boolean;
    readonly primaryError: unknown;
    readonly state: { released: boolean; safeToRelease: boolean };
    readonly transactionStarted: boolean;
}

async function cleanupPostgresStream(
    client: PoolClient,
    statement: SqlStatement,
    cursorName: string,
    cleanup: PostgresStreamCleanupState,
): Promise<void> {
    const canClose = !cleanup.state.released && cleanup.cursorDeclared && (
        cleanup.primaryError === undefined
        || cleanup.primaryError instanceof OperationCanceledError
    );
    let cleanupError: unknown;
    if (canClose) {
        try {
            await client.query(`close ${cursorName}`);
        } catch (error) {
            cleanupError = error;
        }
    }

    if (
        !cleanup.state.released
        && cleanup.ownsTransaction
        && cleanup.transactionStarted
    ) {
        try {
            await client.query(
                cleanup.primaryError === undefined && cleanupError === undefined
                    ? 'commit'
                    : 'rollback',
            );
            cleanup.state.safeToRelease = true;
        } catch (error) {
            cleanupError ??= error;
        }
    }

    if (cleanupError === undefined) {
        return;
    }
    const providerError = createPostgresProviderError(
        'stream',
        cleanupError,
        statement,
    );
    if (cleanup.primaryError !== undefined) {
        throw new DatabaseTransactionCleanupError(
            'postgres',
            cleanup.primaryError,
            providerError,
        );
    }
    throw providerError;
}
