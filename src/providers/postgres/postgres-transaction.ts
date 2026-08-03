import type { PoolClient } from 'pg';
import {
    DatabaseTransactionCleanupError,
} from '../../storage/database-errors';
import type {
    TransactionIsolationLevel,
    TransactionOptions,
} from '../../storage/database-connection';
import { createPostgresProviderError } from './postgres-provider-error';
import { throwIfOperationAborted } from '../../storage/operation-cancellation';
import { TransactionOutcomeUnknownError } from '../../storage/transaction-outcome-unknown-error';
import { isUnknownPostgresCommitOutcome } from './postgres-commit-outcome';

export async function runPostgresTransaction<TResult>(
    client: PoolClient,
    work: () => TResult | Promise<TResult>,
    options?: TransactionOptions,
): Promise<TResult> {
    throwIfOperationAborted(options?.signal);
    let transactionStarted = false;

    try {
        try {
            await client.query(postgresBeginStatement(options));
            transactionStarted = true;
        } catch (error) {
            throw createPostgresProviderError('begin', error);
        }
        throwIfOperationAborted(options?.signal);

        const result = await work();
        throwIfOperationAborted(options?.signal);

        try {
            await client.query('commit');
        } catch (error) {
            const commitError = createPostgresProviderError('commit', error);
            if (isUnknownPostgresCommitOutcome(commitError.code)) {
                throw new TransactionOutcomeUnknownError(
                    'postgres',
                    commitError,
                );
            }
            throw commitError;
        }

        return result;
    } catch (error) {
        if (!transactionStarted) {
            throw error;
        }

        try {
            await client.query('rollback');
        } catch (rollbackError) {
            throw new DatabaseTransactionCleanupError(
                'postgres',
                error,
                createPostgresProviderError('rollback', rollbackError),
            );
        }

        throw error;
    }
}

function postgresBeginStatement(options?: TransactionOptions): string {
    const isolation = options?.isolationLevel
        ? ` isolation level ${postgresIsolationLevel(options.isolationLevel)}`
        : '';
    const access = options?.readOnly === undefined
        ? ''
        : options.readOnly ? ' read only' : ' read write';
    return `begin${isolation}${access}`;
}

function postgresIsolationLevel(level: TransactionIsolationLevel): string {
    const levels: Record<TransactionIsolationLevel, string> = {
        readUncommitted: 'read uncommitted',
        readCommitted: 'read committed',
        repeatableRead: 'repeatable read',
        serializable: 'serializable',
    };
    return levels[level];
}

export async function runPostgresSavepoint<TResult>(
    client: PoolClient,
    depth: number,
    work: () => TResult | Promise<TResult>,
    options?: TransactionOptions,
    onRollbackToSavepoint?: (error: unknown) => void,
): Promise<TResult> {
    throwIfOperationAborted(options?.signal);
    const savepointName = `entitykit_sp_${String(depth)}`;

    try {
        await client.query(`savepoint ${savepointName}`);
    } catch (error) {
        throw createPostgresProviderError('savepoint', error);
    }
    throwIfOperationAborted(options?.signal);

    try {
        const result = await work();
        throwIfOperationAborted(options?.signal);
        try {
            await client.query(`release savepoint ${savepointName}`);
        } catch (error) {
            throw createPostgresProviderError('releaseSavepoint', error);
        }

        return result;
    } catch (error) {
        try {
            await client.query(`rollback to savepoint ${savepointName}`);
            onRollbackToSavepoint?.(error);
        } catch (rollbackError) {
            throw new DatabaseTransactionCleanupError(
                'postgres',
                error,
                createPostgresProviderError(
                    'rollbackToSavepoint',
                    rollbackError,
                ),
            );
        }

        throw error;
    }
}
