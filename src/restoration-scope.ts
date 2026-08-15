import { restorationFailureFrom } from './restoration-actions';

/** Operation-owned primary failure and exhaustive cleanup collector. */
export class RestorationScope {
    private readonly failures: unknown[] = [];
    private primaryCaptured = false;
    private primary: unknown;
    private poisoned = false;

    constructor(
        private readonly markRestorationFailure: (failure: Error) => void,
    ) {}

    public capturePrimary(error: unknown): void {
        if (this.primaryCaptured) return;
        this.primaryCaptured = true;
        this.primary = error;
    }

    public recordFailure(error: unknown): void {
        if (error instanceof AggregateError) {
            for (const nested of error.errors) this.recordFailure(nested);
        } else {
            this.failures.push(error);
        }
    }

    public attempt(action: () => void): void {
        try {
            action();
        } catch (error) {
            this.recordFailure(error);
        }
    }

    public attemptAll(actions: ReadonlyArray<() => void>): void {
        for (const action of actions) this.attempt(action);
    }

    public rethrowPrimary(): never {
        if (!this.primaryCaptured) {
            throw new Error('Restoration scope has no primary failure.');
        }
        this.poisonIfNeeded();
        throw this.primary;
    }

    public throwIfFailed(): void {
        const failure = this.poisonIfNeeded();
        if (failure !== undefined) throw failure;
    }

    private poisonIfNeeded(): Error | undefined {
        const failure = restorationFailureFrom(this.failures);
        if (failure === undefined) return undefined;
        if (!this.poisoned) {
            this.poisoned = true;
            this.markRestorationFailure(failure);
        }
        return failure;
    }
}
