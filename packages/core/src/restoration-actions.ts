import {
    appendRestorationFailure,
    restorationErrorFrom,
} from './restoration-failure-inspection';

/** Convert one or more cleanup failures into one diagnostic error. */
export function restorationFailureFrom(
    failures: readonly unknown[],
): Error | undefined {
    if (failures.length === 0) return undefined;
    if (failures.length === 1) return restorationErrorFrom(failures[0]);
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
            appendRestorationFailure(failures, error);
        }
    }
    const failure = restorationFailureFrom(failures);
    if (failure !== undefined) throw failure;
}
