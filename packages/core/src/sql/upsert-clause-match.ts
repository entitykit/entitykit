/** Authorize a conflict update against values from the proposed row. */
export function excludedColumnMatchClause(
    columns: readonly string[],
    quote: (identifier: string) => string,
    targetQualifier?: string,
): string {
    if (columns.length === 0) return '';
    const predicates = columns.map(column => {
        const target = targetQualifier
            ? `${targetQualifier}.${quote(column)}`
            : quote(column);
        return `${target} = excluded.${quote(column)}`;
    });
    return ` where ${predicates.join(' and ')}`;
}
