import type { EnclosingTransactionState } from '@entitykit/core/adapter';
import type { TransactionOptions } from '@entitykit/core/adapter';
import type { MySqlConnection } from './mysql-driver';
import { runMysqlSavepoint } from './mysql-transaction';

/** Run a pooled MySQL savepoint while maintaining root recovery state. */
export async function runMysqlPooledSavepoint<TResult>(
    connection: MySqlConnection,
    depth: number,
    transactionState: EnclosingTransactionState,
    work: () => TResult | Promise<TResult>,
    options?: TransactionOptions,
    commandTimeoutMs?: number,
): Promise<TResult> {
    try {
        return await runMysqlSavepoint(
            connection,
            depth,
            work,
            options,
            commandTimeoutMs,
            error => {
                transactionState.markRecovered(error);
            },
        );
    } catch (error) {
        transactionState.observeNestedFailure(error);
        throw error;
    }
}
