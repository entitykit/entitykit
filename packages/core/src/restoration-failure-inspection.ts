type FailureShape =
    | { readonly kind: 'plain' }
    | { readonly kind: 'opaque' }
    | { readonly kind: 'aggregate'; readonly members: readonly unknown[] };

function uninspectableFailure(failure: unknown): Error {
    return new Error(
        'Context state restoration produced an uninspectable failure.',
        { cause: failure },
    );
}

function inspectFailure(failure: unknown): FailureShape {
    let members: unknown[];
    try {
        if (!(failure instanceof AggregateError)) return { kind: 'plain' };
        const { errors }: { readonly errors: unknown } = failure;
        members = Array.from(errors as Iterable<unknown>);
    } catch {
        return { kind: 'opaque' };
    }
    return members.length === 0
        ? { kind: 'plain' }
        : { kind: 'aggregate', members };
}

function appendFlattened(
    target: unknown[],
    failure: unknown,
    visited: Set<object>,
): void {
    const shape = inspectFailure(failure);
    if (shape.kind === 'opaque') {
        target.push(uninspectableFailure(failure));
        return;
    }
    if (shape.kind === 'plain' || visited.has(failure as object)) {
        target.push(failure);
        return;
    }
    visited.add(failure as object);
    for (const nested of shape.members) {
        appendFlattened(target, nested, visited);
    }
    visited.delete(failure as object);
}

/** Record one cleanup failure, flattening only what inspects safely. */
export function appendRestorationFailure(
    target: unknown[],
    failure: unknown,
): void {
    try {
        appendFlattened(target, failure, new Set<object>());
    } catch {
        target.push(uninspectableFailure(failure));
    }
}

/** Convert one cleanup failure into an Error without running its traps. */
export function restorationErrorFrom(value: unknown): Error {
    try {
        if (value instanceof Error) return value;
    } catch {
        return uninspectableFailure(value);
    }
    return new Error('Context state restoration failed.', { cause: value });
}
