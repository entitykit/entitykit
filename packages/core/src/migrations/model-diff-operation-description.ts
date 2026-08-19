import type { ModelDiffOperation } from './model-diff-operations';
import { formatMigrationObjectName } from './migration-object-name';

/** Whether applying an operation can discard schema or data. */
export function isDestructiveModelDiffOperation(
    operation: ModelDiffOperation,
): boolean {
    return operation.kind === 'dropTable' ||
    operation.kind === 'dropColumn' ||
    operation.kind === 'dropIndex' ||
    operation.kind === 'dropForeignKey' ||
    operation.kind === 'dropSequence' ||
    operation.kind === 'dropJoinTable';
}

/** Render a concise, provider-independent description of an operation. */
export function describeModelDiffOperation(
    operation: ModelDiffOperation,
): string {
    switch (operation.kind) {
        case 'createTable':
            return `Create table ${formatMigrationObjectName(operation.schemaName, operation.tableName)}`;
        case 'renameTable':
            return `Rename table ${formatMigrationObjectName(operation.schemaName, operation.tableName)} -> ${formatMigrationObjectName(operation.schemaName, operation.newTableName)}`;
        case 'dropTable':
            return `Drop table ${formatMigrationObjectName(operation.schemaName, operation.tableName)}`;
        case 'addColumn':
            return `Add column ${formatMigrationObjectName(operation.schemaName, operation.tableName)}.${operation.column.name}`;
        case 'alterColumn':
            return `Alter column ${formatMigrationObjectName(operation.schemaName, operation.tableName)}.${operation.column.name}`;
        case 'dropColumn':
            return `Drop column ${formatMigrationObjectName(operation.schemaName, operation.tableName)}.${operation.columnName}`;
        case 'createIndex':
            return `Create ${operation.unique ? 'unique ' : ''}index ${operation.name}`;
        case 'dropIndex':
            return `Drop index ${operation.name}`;
        case 'addForeignKey':
            return `Add foreign key ${operation.name}`;
        case 'dropForeignKey':
            return `Drop foreign key ${operation.name}`;
        case 'addCheckConstraint':
            return `Add check constraint ${operation.name}`;
        case 'dropCheckConstraint':
            return `Drop check constraint ${operation.name}`;
        case 'createSequence':
            return `Create sequence ${formatMigrationObjectName(operation.sequence.schemaName, operation.sequence.name)}`;
        case 'alterSequence':
            return `Alter sequence ${formatMigrationObjectName(operation.sequence.schemaName, operation.sequence.name)}`;
        case 'dropSequence':
            return `Drop sequence ${formatMigrationObjectName(operation.sequence.schemaName, operation.sequence.name)}`;
        case 'rebuildTable':
            return `Rebuild table ${formatMigrationObjectName(operation.schemaName, operation.tableName)} when required by the provider`;
        case 'createJoinTable':
            return `Create join table ${formatMigrationObjectName(operation.schemaName, operation.tableName)}`;
        case 'dropJoinTable':
            return `Drop join table ${formatMigrationObjectName(operation.schemaName, operation.tableName)}`;
        default:
            return assertNever(operation);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unsupported model diff operation: ${JSON.stringify(value)}`);
}
