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
        this.appendFailure(error, new Set<AggregateError>());
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

    private appendFailure(
        error: unknown,
        visited: Set<AggregateError>,
    ): void {
        if (!(error instanceof AggregateError) || error.errors.length === 0) {
            this.failures.push(error);
            return;
        }
        if (visited.has(error)) {
            this.failures.push(error);
            return;
        }
        visited.add(error);
        for (const nested of error.errors) {
            this.appendFailure(nested, visited);
        }
        visited.delete(error);
    }
}
