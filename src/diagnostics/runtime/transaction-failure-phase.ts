import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
} from '../../storage/database-errors';
import { isTransactionOutcomeUnknown } from '../../storage/transaction-outcome';
import type { TransactionDiagnosticEvent } from './events';

export function transactionFailurePhase(
    error: unknown,
    nested: boolean,
): TransactionDiagnosticEvent['phase'] {
    if (isTransactionOutcomeUnknown(error)) {
        return 'commit';
    }
    const providerError = providerErrorFromTransactionFailure(error);
    if (!providerError) {
        return nested ? 'rollbackToSavepoint' : 'rollback';
    }

    switch (providerError.operation) {
        case 'begin':
            return 'begin';
        case 'commit':
            return 'commit';
        case 'rollback':
            return 'rollback';
        case 'savepoint':
            return 'savepoint';
        case 'releaseSavepoint':
            return 'release';
        case 'rollbackToSavepoint':
            return 'rollbackToSavepoint';
        case 'connect':
        case 'query':
        case 'stream':
        case 'dispose':
            return nested ? 'rollbackToSavepoint' : 'rollback';
    }
}

function providerErrorFromTransactionFailure(
    error: unknown,
): DatabaseProviderError | undefined {
    if (error instanceof DatabaseProviderError) {
        return error;
    }

    if (error instanceof DatabaseTransactionCleanupError) {
        return error.cleanupError;
    }

    return undefined;
}
