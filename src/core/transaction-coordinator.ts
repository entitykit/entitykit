import type {
    DatabaseConnection,
    TransactionOptions,
} from '../storage/database-connection';

/**
 * The explicit-transaction side of a `DbContext`: the nesting depth of
 * `transaction(...)` scopes and the after-commit callbacks a save defers while
 * one is open.
 *
 * Held apart from the unit-of-work hub because it is a self-contained concern —
 * open a provider transaction, count how deep the caller has nested them, and
 * run the deferred work once the outermost one commits. It owns
 * `contextTransactionDepth` and `afterCommitCallbacks`; the saver reads the
 * depth to decide defer-vs-run and enqueues its post-commit callback here, and
 * `DbContext.dispose` reads the depth to refuse disposal mid-transaction.
 *
 * The connection arrives as a getter and the rollback reset as a closure, so
 * the coordinator never reaches into context internals — and both are resolved
 * lazily, because a `DbContext` builds its collaborators before it has a
 * connection.
 */
export class TransactionCoordinator {
    private contextTransactionDepth = 0;
    private readonly afterCommitCallbacks: DeferredCallback[] = [];

    constructor(
        private readonly getDatabase: () => DatabaseConnection,
        private readonly resetTrackedState: () => void,
    ) {}

    /** The current `transaction(...)` nesting depth; 0 when none is open. */
    public get depth(): number {
        return this.contextTransactionDepth;
    }

    /** Defer commit work, with optional cleanup when its scope rolls back. */
    public enqueueAfterCommitCallback(
        afterCommit: () => void | Promise<void>,
        afterRollback?: () => void,
    ): void {
        this.afterCommitCallbacks.push({ afterCommit, afterRollback });
    }

    /**
   * Run work inside an explicit provider transaction.
   *
   * `saveChanges()` calls inside this callback reuse the explicit transaction.
   */
    public async run<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        const isRootContextTransaction = this.contextTransactionDepth === 0;
        const afterCommitCallbackStart = this.afterCommitCallbacks.length;
        this.contextTransactionDepth += 1;
        let committed = false;

        try {
            const result = await this.getDatabase().transaction(work, options);
            committed = true;
            return result;
        } catch (error) {
            const rolledBackCallbacks =
                this.afterCommitCallbacks.splice(afterCommitCallbackStart);
            for (const callback of rolledBackCallbacks.reverse()) {
                callback.afterRollback?.();
            }
            const deferredCallbacksWereAdded = rolledBackCallbacks.length > 0;
            if (isRootContextTransaction || deferredCallbacksWereAdded) {
                this.resetTrackedState();
            }
            throw error;
        } finally {
            this.contextTransactionDepth -= 1;
            if (isRootContextTransaction && committed) {
                await this.flushAfterCommitCallbacks();
            }
        }
    }

    private async flushAfterCommitCallbacks(): Promise<void> {
        const callbacks = this.afterCommitCallbacks.splice(0);
        const errors: unknown[] = [];
        for (const callback of callbacks) {
            try {
                await callback.afterCommit();
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length === 1) {
            throw errors[0];
        }
        if (errors.length > 1) {
            throw new AggregateError(
                errors,
                'Multiple after-commit callbacks failed.',
            );
        }
    }
}

interface DeferredCallback {
    readonly afterCommit: () => void | Promise<void>;
    readonly afterRollback?: () => void;
}
