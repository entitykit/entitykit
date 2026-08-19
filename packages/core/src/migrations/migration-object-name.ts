/** Format a provider-neutral schema object name for diagnostics and warnings. */
export function formatMigrationObjectName(
    schemaName: string | undefined,
    objectName: string,
): string {
    return schemaName ? `${schemaName}.${objectName}` : objectName;
}
