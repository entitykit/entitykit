import type { TransactionOptions } from '../storage/database-connection';
import { validateTransactionOptions } from '../storage/transaction-options';

export function validateRecordingTransactionOptions(
    nested: boolean,
    options?: TransactionOptions,
): void {
    validateTransactionOptions(options);
    if (
        nested
        && options
        && (options.isolationLevel !== undefined || options.readOnly !== undefined)
    ) {
        throw new Error(
            'Nested recording transactions cannot change transaction options.',
        );
    }
}
