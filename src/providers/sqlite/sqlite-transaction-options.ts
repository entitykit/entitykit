import type { TransactionOptions } from '../../storage/database-connection';
import type { DatabaseProviderOperation } from '../../storage/database-provider-error';

type ExecuteControl = (
    sql: string,
    operation: DatabaseProviderOperation,
) => void;

export function applySqliteTransactionOptions(
    options: TransactionOptions | undefined,
    resets: Array<() => void>,
    exec: ExecuteControl,
): void {
    if (options?.isolationLevel === 'readUncommitted') {
        exec('pragma read_uncommitted = ON', 'begin');
        resets.push(() => {
            exec('pragma read_uncommitted = OFF', 'rollback');
        });
    }
    if (options?.readOnly === true) {
        exec('pragma query_only = ON', 'begin');
        resets.push(() => {
            exec('pragma query_only = OFF', 'rollback');
        });
    }
}

export function validateSqliteTransactionOptions(
    options?: TransactionOptions,
): void {
    if (
        options?.isolationLevel === 'readCommitted'
        || options?.isolationLevel === 'repeatableRead'
    ) {
        throw new Error(
            `SQLite does not support '${options.isolationLevel}' transaction isolation. Use 'serializable' or 'readUncommitted'.`,
        );
    }
}
