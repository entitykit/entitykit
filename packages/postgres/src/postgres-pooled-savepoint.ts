import type { TransactionOptions } from '../../storage/database-connection';
import type { EnclosingTransactionState } from '../../storage/enclosing-transaction-state';
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
