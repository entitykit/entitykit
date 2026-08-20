import type { TransactionOptions } from '@entitykit/core/adapter';
import { validateTransactionOptions } from '@entitykit/core/adapter';

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
