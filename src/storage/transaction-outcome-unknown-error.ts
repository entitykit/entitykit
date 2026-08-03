import type { DatabaseProviderError } from './database-provider-error';

/** A commit acknowledgement was lost, so the durable outcome cannot be inferred. */
export class TransactionOutcomeUnknownError extends Error {
    public override readonly cause: DatabaseProviderError;
    public readonly operation = 'commit' as const;
    public readonly retryable = false as const;

    constructor(
        public readonly provider: string,
        public readonly commitError: DatabaseProviderError,
    ) {
        super(
            `${capitalizeProvider(provider)} commit outcome is unknown because the connection failed while awaiting commit.`,
        );
        this.name = 'TransactionOutcomeUnknownError';
        this.cause = commitError;
    }

    public toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            message: this.message,
            provider: this.provider,
            operation: this.operation,
            retryable: this.retryable,
            commitError: this.commitError.toJSON(),
        };
    }
}

function capitalizeProvider(provider: string): string {
    return provider.length === 0
        ? 'Provider'
        : `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
}
