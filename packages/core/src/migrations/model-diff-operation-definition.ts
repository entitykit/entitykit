import type {
    MigrationForeignKeyDefinition,
    MigrationIndexDefinition,
    MigrationTableForeignKey,
} from './migration-builder';
import type { ModelDiffOperation } from './model-diff-operations';

export function indexDefinition(
    operation: Extract<ModelDiffOperation, { kind: 'createIndex' | 'dropIndex' }>,
): MigrationIndexDefinition {
    return {
        name: operation.name,
        tableName: operation.tableName,
        schemaName: operation.schemaName,
        columns: operation.columns,
        keyParts: operation.keyParts,
        includedColumns: operation.includedColumns,
        filter: operation.filter,
        unique: operation.unique,
    };
}

export function foreignKeyDefinition(
    operation: Extract<ModelDiffOperation, { kind: 'addForeignKey' | 'dropForeignKey' }>,
): MigrationForeignKeyDefinition {
    return {
        name: operation.name,
        tableName: operation.tableName,
        schemaName: operation.schemaName,
        columns: operation.columns,
        principalTableName: operation.principalTableName,
        principalSchemaName: operation.principalSchemaName,
        principalColumns: operation.principalColumns,
        onDelete: operation.onDelete,
    };
}

export function tableForeignKeyDefinition(
    operation: Extract<ModelDiffOperation, { kind: 'addForeignKey' | 'dropForeignKey' }>,
): MigrationTableForeignKey {
    return {
        name: operation.name,
        columns: operation.columns,
        principalTableName: operation.principalTableName,
        principalSchemaName: operation.principalSchemaName,
        principalColumns: operation.principalColumns,
        onDelete: operation.onDelete,
    };
}
