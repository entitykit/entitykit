import type { MigrationTableShape } from './migration-builder';
import type { CreateJoinTableOperation, DropJoinTableOperation } from './model-diff-operations';
import { joinTableColumnSets } from './model-diff-join-table-columns';
import { withPrimaryKeyOrder } from './migration-primary-key-order';

/** Physical join-table definition shared by initial creation and rebuilding. */
export function joinTableDefinition(
    operation: CreateJoinTableOperation | DropJoinTableOperation,
): MigrationTableShape {
    const columns = joinTableColumnSets(operation);
    return {
        tableName: operation.tableName,
        schemaName: operation.schemaName,
        primaryKeyName: operation.primaryKeyName,
        columns: withPrimaryKeyOrder(operation.columns.map(column => ({
            ...column,
            primaryKey: operation.primaryKeyColumns.includes(column.name),
        })), operation.primaryKeyColumns),
        foreignKeys: [
            {
                name: operation.sourceConstraintName,
                columns: columns.sourceColumns,
                principalTableName: operation.sourceTableName,
                principalSchemaName: operation.sourceSchemaName,
                principalColumns: columns.sourcePrincipalColumns,
                onDelete: operation.deleteBehavior,
            },
            {
                name: operation.targetConstraintName,
                columns: columns.targetColumns,
                principalTableName: operation.targetTableName,
                principalSchemaName: operation.targetSchemaName,
                principalColumns: columns.targetPrincipalColumns,
                onDelete: operation.deleteBehavior,
            },
        ],
        checkConstraints: [],
        indexes: [],
    };
}
