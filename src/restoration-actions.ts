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
    appendFailureGuarded(target, failure, new Set<AggregateError>());
}

function appendFailureGuarded(
    target: unknown[],
    failure: unknown,
    visited: Set<AggregateError>,
): void {
    if (!(failure instanceof AggregateError) || failure.errors.length === 0) {
        target.push(failure);
        return;
    }
    if (visited.has(failure)) {
        target.push(failure);
        return;
    }
    visited.add(failure);
    for (const nested of failure.errors) {
        appendFailureGuarded(target, nested, visited);
    }
    visited.delete(failure);
}

function asError(value: unknown): Error {
    return value instanceof Error
        ? value
        : new Error('Context state restoration failed.', { cause: value });
}
