import type { ModelDiffOperation } from './model-diff-operations';
import { reverseAlterColumn } from './model-diff-reverse-column';
import { reverseRebuild } from './model-diff-sqlite-rebuild';

/** Return the operation that restores the schema state preceding `operation`. */
export function reverseModelDiffOperation(
    operation: ModelDiffOperation,
): ModelDiffOperation {
    switch (operation.kind) {
        case 'createTable':
            return { ...operation, kind: 'dropTable' };
        case 'dropTable':
            return { ...operation, kind: 'createTable' };
        case 'renameTable':
            return {
                ...operation,
                tableName: operation.newTableName,
                newTableName: operation.tableName,
            };
        case 'addColumn':
            return {
                kind: 'dropColumn',
                entityName: operation.entityName,
                tableName: operation.tableName,
                schemaName: operation.schemaName,
                columnName: operation.column.name,
                column: operation.column,
            };
        case 'dropColumn':
            return {
                kind: 'addColumn',
                entityName: operation.entityName,
                tableName: operation.tableName,
                schemaName: operation.schemaName,
                column: operation.column,
            };
        case 'alterColumn':
            return {
                ...operation,
                column: reverseAlterColumn(operation.column),
            };
        case 'createIndex':
            return { ...operation, kind: 'dropIndex' };
        case 'dropIndex':
            return { ...operation, kind: 'createIndex' };
        case 'addForeignKey':
            return { ...operation, kind: 'dropForeignKey' };
        case 'dropForeignKey':
            return { ...operation, kind: 'addForeignKey' };
        case 'addCheckConstraint':
            return { ...operation, kind: 'dropCheckConstraint' };
        case 'dropCheckConstraint':
            return { ...operation, kind: 'addCheckConstraint' };
        case 'createSequence':
            return { ...operation, kind: 'dropSequence' };
        case 'dropSequence':
            return { ...operation, kind: 'createSequence' };
        case 'alterSequence':
            return {
                ...operation,
                sequence: operation.previous,
                previous: operation.sequence,
            };
        case 'rebuildTable':
            return reverseRebuild(operation);
        case 'createJoinTable':
            return { ...operation, kind: 'dropJoinTable' };
        case 'dropJoinTable':
            return { ...operation, kind: 'createJoinTable' };
        default:
            return assertNever(operation);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unsupported model diff operation: ${JSON.stringify(value)}`);
}
