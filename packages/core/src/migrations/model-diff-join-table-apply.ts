import type { MigrationBuilder } from './migration-builder';
import type {
    CreateJoinTableOperation,
    DropJoinTableOperation,
} from './model-diff-operations';
import { joinTableColumnSets } from './model-diff-join-table-columns';

/** Apply the compound schema operation shared by join-table create and restore. */
export function applyCreateJoinTable(
    builder: MigrationBuilder,
    operation: CreateJoinTableOperation | DropJoinTableOperation,
): void {
    const columns = joinTableColumnSets(operation);
    if (operation.schemaName) {
        builder.createSchema(operation.schemaName);
    }
    builder.createTable(operation.tableName, operation.columns.map(column => ({
        ...column,
        primaryKey: operation.primaryKeyColumns.includes(column.name),
    })), operation.schemaName, {
        primaryKeyName: operation.primaryKeyName,
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
    });
}
