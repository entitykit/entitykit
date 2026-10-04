import type { MigrationBuilder } from './migration-builder';
import type {
    CreateJoinTableOperation,
    DropJoinTableOperation,
} from './model-diff-operations';
import { joinTableDefinition } from './model-diff-join-table-definition';

/** Apply the compound schema operation shared by join-table create and restore. */
export function applyCreateJoinTable(
    builder: MigrationBuilder,
    operation: CreateJoinTableOperation | DropJoinTableOperation,
): void {
    const definition = joinTableDefinition(operation);
    if (operation.schemaName) {
        builder.createSchema(operation.schemaName);
    }
    builder.createTable(operation.tableName, definition.columns, operation.schemaName, {
        primaryKeyName: definition.primaryKeyName,
        foreignKeys: definition.foreignKeys,
    });
}
