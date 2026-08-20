import type { TransactionOptions } from '@entitykit/core/adapter';
import type { EnclosingTransactionState } from '@entitykit/core/adapter';
import type { PoolClient } from './postgres-driver';
import { runPostgresSavepoint } from './postgres-transaction';

/** Run a pooled Postgres savepoint while maintaining root recovery state. */
export async function runPostgresPooledSavepoint<TResult>(
    client: PoolClient,
    depth: number,
    transactionState: EnclosingTransactionState,
    work: () => TResult | Promise<TResult>,
    options?: TransactionOptions,
): Promise<TResult> {
    try {
        return await runPostgresSavepoint(
            client,
            depth,
            work,
            options,
            error => {
                transactionState.markRecovered(error);
            },
        );
    } catch (error) {
        transactionState.observeNestedFailure(error);
        throw error;
    }
}
