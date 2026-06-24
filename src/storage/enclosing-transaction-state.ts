import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
} from './database-errors';

/**
 * Remembers when caught nested-transaction failures make a root transaction
 * unsafe to commit, while allowing an enclosing savepoint rollback to recover.
 */
export class EnclosingTransactionState {
    private failure?: unknown;
    private readonly recoveredFailures: Set<unknown> = new Set();

    public reset(): void {
        this.failure = undefined;
        this.recoveredFailures.clear();
    }

    public markUnusable(error: unknown): void {
        this.failure ??= error;
    }

    public markRecovered(error: unknown): void {
        if (this.failure === error) {
            this.failure = undefined;
        }
        this.recoveredFailures.add(error);
    }

    public observeNestedFailure(error: unknown): void {
        const recovered = this.recoveredFailures.delete(error);
        if (
            !recovered
            && this.failure === undefined
            && compromisesEnclosingTransaction(error)
        ) {
            this.failure = error;
        }
    }

    public async runRootWork<TResult>(
        provider: string,
        work: () => TResult | Promise<TResult>,
    ): Promise<TResult> {
        try {
            const result = await work();
            this.throwIfUnusable(provider);
            return result;
        } catch (error) {
            this.throwIfUnusable(provider);
            throw error;
        }
    }

    private throwIfUnusable(provider: string): void {
        if (this.failure === undefined) {
            return;
        }
        if (this.failure instanceof Error) {
            throw this.failure;
        }
        throw new Error(
            `A nested ${provider} transaction left the enclosing transaction unusable.`,
            { cause: this.failure },
        );
    }
}

function compromisesEnclosingTransaction(error: unknown): boolean {
    return error instanceof DatabaseTransactionCleanupError
        || error instanceof DatabaseProviderError && error.operation === 'savepoint';
}
