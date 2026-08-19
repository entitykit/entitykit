import type { SqlParameterBag } from './sql-statement';

/**
 * The shared seam between select fragment rendering and the query builders.
 *
 * A handful of dialect-aware fragments — how a column is qualified, how one
 * `order by` term carries the provider's null handling, how `limit`/`offset`
 * are appended — must render in exactly one place so the row, joined, and
 * aggregate query shapes cannot drift apart. One renderer implements this
 * interface and is shared by the sub-builders, so nothing is
 * duplicated and every `SqlParameterBag.add(...)` still happens in the original
 * order.
 */
export interface SelectFragmentHost {
    columnSql(columnName: string, tableAlias?: string): string;
    orderTerm(columnExpr: string, direction: string): string;
    pushLimitAndOffset(
        parts: string[],
        query: { readonly limit?: number; readonly offset?: number },
        parameters: SqlParameterBag
    ): void;
}
