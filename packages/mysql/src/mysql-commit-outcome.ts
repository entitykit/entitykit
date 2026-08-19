import { DatabaseProviderError } from '../../storage/database-errors';
import { TransactionOutcomeUnknownError } from '../../storage/transaction-outcome-unknown-error';
import { createMysqlProviderError } from './mysql-provider-error';

/** Classify a MySQL commit rejection by proof of transaction abortion. */
export function mysqlCommitFailure(cause: unknown): DatabaseProviderError {
    const error = cause instanceof DatabaseProviderError
        ? cause
        : createMysqlProviderError('commit', cause);
    if (error.code === 'ER_LOCK_DEADLOCK') {
        return error;
    }
    throw new TransactionOutcomeUnknownError('mysql', error);
}
