import { DatabaseTransactionCleanupError } from './database-transaction-cleanup-error';
import { TransactionOutcomeUnknownError } from './transaction-outcome-unknown-error';

/** Find an unknown commit outcome directly or beneath rollback cleanup failure. */
export function findTransactionOutcomeUnknown(
    error: unknown,
): TransactionOutcomeUnknownError | undefined {
    if (error instanceof TransactionOutcomeUnknownError) {
        return error;
    }
    if (error instanceof DatabaseTransactionCleanupError) {
        return findTransactionOutcomeUnknown(error.primaryError);
    }
    return undefined;
}

export function isTransactionOutcomeUnknown(error: unknown): boolean {
    return findTransactionOutcomeUnknown(error) !== undefined;
}
