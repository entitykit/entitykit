import type { MigrationBuilder, MigrationTableForeignKey } from './migration-builder';
import { applyCreateJoinTable } from './model-diff-join-table-apply';
import type { ModelDiffOperation } from './model-diff-operations';

export function applyUp(
    builder: MigrationBuilder,
    operation: ModelDiffOperation,
    inlineForeignKeysForTable?: readonly MigrationTableForeignKey[],
): void {
    switch (operation.kind) {
        case 'createTable':
            if (operation.schemaName) {
                builder.createSchema(operation.schemaName);
            }
            builder.createTable(operation.tableName, operation.columns, operation.schemaName, {
                foreignKeys: inlineForeignKeysForTable,
                checkConstraints: operation.checkConstraints,
            });
            return;
        case 'renameTable':
            builder.renameTable(operation.tableName, operation.newTableName, operation.schemaName);
            return;
        case 'dropTable':
            builder.dropTable(operation.tableName, operation.schemaName);
            return;
        case 'addColumn':
            builder.addColumn(operation.tableName, operation.column, operation.schemaName);
            return;
        case 'alterColumn':
            builder.alterColumn(operation.tableName, operation.column, operation.schemaName);
            return;
        case 'dropColumn':
            builder.dropColumn(operation.tableName, operation.columnName, operation.schemaName);
            return;
        case 'createIndex':
            builder.createIndex(operation);
            return;
        case 'dropIndex':
            builder.dropIndex(operation.name, operation.schemaName, { tableName: operation.tableName });
            return;
        case 'addForeignKey':
            builder.addForeignKey(operation);
            return;
        case 'dropForeignKey':
            builder.dropForeignKey(operation.tableName, operation.name, operation.schemaName);
            return;
        case 'addCheckConstraint':
            builder.addCheckConstraint(operation.tableName, operation.name, operation.sql, operation.schemaName);
            return;
        case 'dropCheckConstraint':
            builder.dropCheckConstraint(operation.tableName, operation.name, operation.schemaName);
            return;
        case 'createSequence':
            builder.createSequence(operation.sequence);
            return;
        case 'alterSequence':
            builder.alterSequence(operation.sequence, operation.previous);
            return;
        case 'dropSequence':
            builder.dropSequence(operation.sequence);
            return;
        case 'rebuildTable':
            if (builder.requiresTableRebuild) {
                builder.rebuildTable(operation.definition);
            }
            return;
        case 'createJoinTable':
            applyCreateJoinTable(builder, operation);
            return;
        case 'dropJoinTable':
            builder.dropTable(operation.tableName, operation.schemaName);
            return;
        default:
            return assertNever(operation);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unhandled model diff operation: ${JSON.stringify(value)}`);
}
