import type { DatabaseProviderError } from '@entitykit/core/adapter';
import { TransactionOutcomeUnknownError } from '@entitykit/core/adapter';
import { createPostgresProviderError } from './postgres-provider-error';

/** Classify a Postgres commit rejection by proof of transaction abortion. */
export function postgresCommitFailure(cause: unknown): DatabaseProviderError {
    const error = createPostgresProviderError('commit', cause);
    if (error.code === '40001' || error.code === '40P01') {
        return error;
    }
    throw new TransactionOutcomeUnknownError('postgres', error);
}
