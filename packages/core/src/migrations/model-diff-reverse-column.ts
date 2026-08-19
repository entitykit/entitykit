import type { MigrationAlterColumnDefinition } from './migration-builder';

/** Reverse an alter-column definition without losing its forward metadata. */
export function reverseAlterColumn(
    column: MigrationAlterColumnDefinition,
): MigrationAlterColumnDefinition {
    return {
        ...column,
        name: column.oldName ?? column.name,
        oldName: column.oldName ? column.name : column.oldName,
        type: column.oldType ?? column.type,
        nullable: column.oldNullable,
        defaultSql: column.oldDefaultSql,
        computedSql: column.oldComputedSql,
        computedStored: column.oldComputedStored,
        collation: column.oldCollation,
        storeGeneration: column.oldStoreGeneration,
        oldType: column.type,
        oldNullable: column.nullable,
        oldDefaultSql: column.defaultSql,
        oldComputedSql: column.computedSql,
        oldComputedStored: column.computedStored,
        oldCollation: column.collation,
        oldStoreGeneration: column.storeGeneration,
    };
}
