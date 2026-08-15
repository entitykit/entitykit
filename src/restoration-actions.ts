/** Convert one or more cleanup failures into one diagnostic error. */
export function restorationFailureFrom(
    failures: readonly unknown[],
): Error | undefined {
    if (failures.length === 0) return undefined;
    if (failures.length === 1) return asError(failures[0]);
    return new AggregateError(
        failures,
        'Multiple context state restoration phases failed.',
    );
}

/** Run every cleanup action before reporting any failure. */
export function runRestorationActions(
    actions: ReadonlyArray<() => void>,
): void {
    const failures: unknown[] = [];
    for (const action of actions) {
        try {
            action();
        } catch (error) {
            appendFailure(failures, error);
        }
    }
    const failure = restorationFailureFrom(failures);
    if (failure !== undefined) throw failure;
}

function appendFailure(target: unknown[], failure: unknown): void {
    if (failure instanceof AggregateError) {
        for (const nested of failure.errors) appendFailure(target, nested);
        return;
    }
    target.push(failure);
}

function asError(value: unknown): Error {
    return value instanceof Error
        ? value
        : new Error('Context state restoration failed.', { cause: value });
}
