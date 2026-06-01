/**
 * A cardinality terminal may read fewer rows than its input sequence permits,
 * but it must never widen an existing `take(...)`.
 */
export function terminalQueryLimit(
    existing: number | undefined,
    requested: number,
): number {
    return existing === undefined ? requested : Math.min(existing, requested);
}
