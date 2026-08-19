import type { MigrationTableForeignKey } from './migration-builder';
import { renderCreateJoinTableOperation } from './migration-join-table-renderer';
import {
    isColumnRenameOnly,
    literalOptional,
    unsupportedOperation,
} from './migration-operation-render-helpers';
import {
    foreignKeyDefinition,
    indexDefinition,
} from './model-diff-operation-definition';
import type { ModelDiffOperation } from './model-differ';

export function renderUpOperation(
    operation: ModelDiffOperation,
    inlineForeignKeysForTable?: readonly MigrationTableForeignKey[],
): string {
    switch (operation.kind) {
        case 'createTable':
            return [
                operation.schemaName
                    ? `    builder.createSchema(${JSON.stringify(operation.schemaName)});`
                    : undefined,
                renderCreateTable(operation, inlineForeignKeysForTable),
            ].filter(Boolean).join('\n');
        case 'renameTable':
            return `    builder.renameTable(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.newTableName)}, ${literalOptional(operation.schemaName)});`;
        case 'dropTable':
            return `    builder.dropTable(${JSON.stringify(operation.tableName)}, ${literalOptional(operation.schemaName)});`;
        case 'addColumn':
            return `    builder.addColumn(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.column, null, 2)}, ${literalOptional(operation.schemaName)});`;
        case 'alterColumn':
            return isColumnRenameOnly(operation)
                ? `    builder.renameColumn(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.column.oldName)}, ${JSON.stringify(operation.column.name)}, ${literalOptional(operation.schemaName)});`
                : `    builder.alterColumn(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.column, null, 2)}, ${literalOptional(operation.schemaName)});`;
        case 'dropColumn':
            return `    builder.dropColumn(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.columnName)}, ${literalOptional(operation.schemaName)});`;
        case 'createIndex':
            return `    builder.createIndex(${JSON.stringify(indexDefinition(operation), null, 2)});`;
        case 'dropIndex':
            return `    builder.dropIndex(${JSON.stringify(operation.name)}, ${literalOptional(operation.schemaName)}, { tableName: ${JSON.stringify(operation.tableName)} });`;
        case 'addForeignKey':
            return `    builder.addForeignKey(${JSON.stringify(foreignKeyDefinition(operation), null, 2)});`;
        case 'dropForeignKey':
            return `    builder.dropForeignKey(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.name)}, ${literalOptional(operation.schemaName)});`;
        case 'addCheckConstraint':
            return `    builder.addCheckConstraint(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.name)}, ${JSON.stringify(operation.sql)}, ${literalOptional(operation.schemaName)});`;
        case 'dropCheckConstraint':
            return `    builder.dropCheckConstraint(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.name)}, ${literalOptional(operation.schemaName)});`;
        case 'createSequence':
            return `    builder.createSequence(${JSON.stringify(operation.sequence, null, 2)});`;
        case 'alterSequence':
            return `    builder.alterSequence(${JSON.stringify(operation.sequence, null, 2)}, ${JSON.stringify(operation.previous, null, 2)});`;
        case 'dropSequence':
            return `    builder.dropSequence(${JSON.stringify(operation.sequence, null, 2)});`;
        case 'rebuildTable':
            return `    builder.rebuildTable(${JSON.stringify(operation.definition, null, 2)});`;
        case 'createJoinTable':
            return renderCreateJoinTableOperation(operation);
        case 'dropJoinTable':
            return `    builder.dropTable(${JSON.stringify(operation.tableName)}, ${literalOptional(operation.schemaName)});`;
        default:
            return unsupportedOperation(operation);
    }
}

function renderCreateTable(
    operation: Extract<ModelDiffOperation, { kind: 'createTable' }>,
    foreignKeys?: readonly MigrationTableForeignKey[],
): string {
    const tableOptions = {
        foreignKeys: foreignKeys?.length ? foreignKeys : undefined,
        checkConstraints: operation.checkConstraints?.length
            ? operation.checkConstraints
            : undefined,
    };
    const options = tableOptions.foreignKeys || tableOptions.checkConstraints
        ? `, ${JSON.stringify(tableOptions, null, 2)}`
        : '';
    return `    builder.createTable(${JSON.stringify(operation.tableName)}, ${JSON.stringify(operation.columns, null, 2)}, ${literalOptional(operation.schemaName)}${options});`;
}
