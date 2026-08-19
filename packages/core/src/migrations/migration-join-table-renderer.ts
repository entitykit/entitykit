import type { ModelDiffOperation } from './model-differ';
import { literalOptional } from './migration-operation-render-helpers';
import { joinTableColumnSets } from './model-diff-join-table-columns';

export function renderCreateJoinTableOperation(
    operation: Extract<
        ModelDiffOperation,
        { kind: 'createJoinTable' | 'dropJoinTable' }
    >,
): string {
    const columnSets = joinTableColumnSets(operation);
    const columns = operation.columns.map(column => ({
        ...column,
        primaryKey: operation.primaryKeyColumns.includes(column.name),
    }));
    const options = {
        primaryKeyName: operation.primaryKeyName,
        foreignKeys: [
            {
                name: operation.sourceConstraintName,
                columns: columnSets.sourceColumns,
                principalTableName: operation.sourceTableName,
                principalSchemaName: operation.sourceSchemaName,
                principalColumns: columnSets.sourcePrincipalColumns,
                onDelete: operation.deleteBehavior,
            },
            {
                name: operation.targetConstraintName,
                columns: columnSets.targetColumns,
                principalTableName: operation.targetTableName,
                principalSchemaName: operation.targetSchemaName,
                principalColumns: columnSets.targetPrincipalColumns,
                onDelete: operation.deleteBehavior,
            },
        ],
    };
    return [
        operation.schemaName
            ? `    builder.createSchema(${JSON.stringify(operation.schemaName)});`
            : undefined,
        `    builder.createTable(${JSON.stringify(operation.tableName)}, ${JSON.stringify(columns, null, 2)}, ${literalOptional(operation.schemaName)}, ${JSON.stringify(options, null, 2)});`,
    ]
        .filter(Boolean)
        .join('\n');
}
