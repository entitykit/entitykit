import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
} from './database-errors';
import { findTransactionOutcomeUnknown } from './transaction-outcome';
import type { TransactionOutcomeUnknownError } from './transaction-outcome-unknown-error';

/** Tracks when a connection must not be reused after transaction failure. */
export class TransactionUsability {
    private outcomeUnknown?: TransactionOutcomeUnknownError;

    public assertUsable(): void {
        if (this.outcomeUnknown) {
            throw this.outcomeUnknown;
        }
    }

    public observeFailure(error: unknown): boolean {
        this.outcomeUnknown = findTransactionOutcomeUnknown(error);
        return this.outcomeUnknown !== undefined ||
            error instanceof DatabaseTransactionCleanupError &&
                error.operation === 'rollback' ||
            error instanceof DatabaseProviderError && error.operation === 'begin';
    }
}
