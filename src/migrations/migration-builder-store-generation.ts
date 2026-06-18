import type {
    MigrationAlterColumnDefinition,
    MigrationColumnDefinition,
} from './migration-builder-types';

export function assertExclusiveStoreGeneration(
    column: MigrationColumnDefinition,
): void {
    if (
        column.storeGeneration &&
        (column.defaultSql !== undefined || column.computedSql !== undefined)
    ) {
        throw new Error(
            `Migration column '${column.name}' cannot combine store generation with a default or computed expression.`,
        );
    }
}

export function hasStoreGenerationChange(
    column: MigrationAlterColumnDefinition,
): boolean {
    return JSON.stringify(column.storeGeneration) !==
        JSON.stringify(column.oldStoreGeneration);
}

export function mustDropDefaultBeforeStoreGeneration(
    column: MigrationAlterColumnDefinition,
): boolean {
    return column.storeGeneration !== undefined &&
        column.oldDefaultSql !== undefined;
}
