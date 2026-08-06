/** Authorize a conflict update against values from the proposed row. */
export function excludedColumnMatchClause(
    columns: readonly string[],
    quote: (identifier: string) => string,
): string {
    if (columns.length === 0) return '';
    const predicates = columns.map(column =>
        `${quote(column)} = excluded.${quote(column)}`,
    );
    return ` where ${predicates.join(' and ')}`;
}
