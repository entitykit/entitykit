import type { SqlDialect } from '@entitykit/core/adapter';

export function sqliteCreateSchemaStatements(schemaName: string): readonly string[] {
    assertMainSchema(schemaName);
    return [];
}

export function sqliteDropSchemaStatement(schemaName: string): string {
    throw new Error(`SQLite schema '${schemaName}' cannot be dropped. Manage the database file explicitly.`);
}

export function sqliteDdlTableReference(
    this: SqlDialect,
    schemaName: string | undefined,
    tableName: string,
): string {
    if (schemaName !== undefined) assertMainSchema(schemaName);
    return this.quoteIdentifier(tableName);
}

function assertMainSchema(schemaName: string): void {
    if (schemaName.toLowerCase() !== 'main') {
        throw new Error(`SQLite schema '${schemaName}' is unsupported. Use the implicit main schema.`);
    }
}
