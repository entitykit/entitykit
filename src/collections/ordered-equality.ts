/** Compare two sequences without discarding order or duplicate values. */
export function orderedEqual<T>(
    left: readonly T[] | undefined,
    right: readonly T[],
): boolean {
    return left?.length === right.length &&
        right.every((value, index) => left[index] === value);
}
