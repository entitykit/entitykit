import type { SelectFragmentHost } from '../select-fragment-host';
import type { SqlDialect } from '../sql-dialect';
import type { SqlParameterBag } from '../sql-statement';

export class SelectFragmentRenderer implements SelectFragmentHost {
    constructor(private readonly dialect: SqlDialect) {}

    public pushLimitAndOffset(
        parts: string[],
        query: { readonly limit?: number; readonly offset?: number },
        parameters: SqlParameterBag,
    ): void {
        if (query.limit !== undefined) {
            parts.push(`limit ${parameters.add(query.limit)}`);
        } else if (query.offset !== undefined) {
            const unlimited = this.dialect.unlimitedLimitLiteral?.();
            if (unlimited !== undefined) {
                parts.push(`limit ${unlimited}`);
            }
        }

        if (query.offset !== undefined) {
            parts.push(`offset ${parameters.add(query.offset)}`);
        }
    }

    public orderTerm(columnExpr: string, direction: string): string {
        const normalized = direction === 'desc' ? 'desc' : 'asc';
        const prefix = this.dialect.nullOrderingPrefix?.(columnExpr, normalized) ?? '';
        const suffix = this.dialect.nullOrderingClause?.(normalized) ?? '';
        return `${prefix}${columnExpr} ${direction}${suffix}`;
    }

    public columnSql(columnName: string, tableAlias?: string): string {
        const column = this.dialect.quoteIdentifier(columnName);
        return tableAlias
            ? `${this.dialect.quoteIdentifier(tableAlias)}.${column}`
            : column;
    }
}
