import type { TransactionOptions } from './database-connection';

const isolationLevels = new Set([
    'readUncommitted',
    'readCommitted',
    'repeatableRead',
    'serializable',
]);

export function validateTransactionOptions(options?: TransactionOptions): void {
    if (
        options?.isolationLevel !== undefined
        && !isolationLevels.has(options.isolationLevel)
    ) {
        throw new Error(
            `Unknown transaction isolation level '${options.isolationLevel}'.`,
        );
    }
    if (options?.readOnly !== undefined && typeof options.readOnly !== 'boolean') {
        throw new Error(
            `Transaction readOnly must be a boolean, received ${String(options.readOnly)}.`,
        );
    }
}
