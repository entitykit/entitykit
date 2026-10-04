import type { SqlDialect } from './sql-dialect';

export function ddlTableReference(
    dialect: SqlDialect,
    schemaName: string | undefined,
    tableName: string,
): string {
    return dialect.ddlTableReference?.(schemaName, tableName) ??
        dialect.quoteQualifiedIdentifier(schemaName, tableName);
}
