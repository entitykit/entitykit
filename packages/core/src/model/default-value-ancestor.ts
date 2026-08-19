/** Run default normalization while rejecting only active recursive cycles. */
export function withDefaultAncestor<TResult>(
    value: object,
    path: string,
    ancestors: Set<object>,
    work: () => TResult,
    cyclic: (path: string) => Error,
): TResult {
    if (ancestors.has(value)) {
        throw cyclic(path);
    }
    ancestors.add(value);
    try {
        return work();
    } finally {
        ancestors.delete(value);
    }
}
