const associatedFailures: WeakMap<object, unknown[]> = new WeakMap();

/** Keep a cleanup failure beside the operation error that must remain primary. */
export function associateRestorationFailure(
    operationError: unknown,
    restorationError: unknown,
): void {
    if (!isWeakKey(operationError)) return;
    const failures = associatedFailures.get(operationError) ?? [];
    failures.push(restorationError);
    associatedFailures.set(operationError, failures);
}

export function associatedRestorationFailures(
    operationError: unknown,
): readonly unknown[] {
    const failures: unknown[] = [];
    const visited: WeakSet<object> = new WeakSet();
    let current = operationError;
    while (isWeakKey(current) && !visited.has(current)) {
        visited.add(current);
        failures.push(...associatedFailures.get(current) ?? []);
        current = current instanceof Error ? current.cause : undefined;
    }
    return failures;
}

/** Run every restoration phase and return one diagnostic failure. */
export function restorationFailureFrom(
    actions: ReadonlyArray<() => void>,
    initial: readonly unknown[] = [],
): Error | undefined {
    const failures = [...initial];
    for (const action of actions) {
        try {
            action();
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length === 0) return undefined;
    if (failures.length === 1) return asError(failures[0]);
    return new AggregateError(
        failures,
        'Multiple context state restoration phases failed.',
    );
}

export function runRestorationActions(
    actions: ReadonlyArray<() => void>,
): void {
    const failure = restorationFailureFrom(actions);
    if (failure !== undefined) throw failure;
}

function isWeakKey(value: unknown): value is object {
    return typeof value === 'object' && value !== null ||
        typeof value === 'function';
}

function asError(value: unknown): Error {
    return value instanceof Error
        ? value
        : new Error('Context state restoration failed.', { cause: value });
}
