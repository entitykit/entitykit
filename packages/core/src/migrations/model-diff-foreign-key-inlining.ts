import type {
    MigrationBuilder,
    MigrationTableForeignKey,
} from './migration-builder';
import type { ModelDiffOperation } from './model-diff-operations';

export interface InlinedForeignKeys {
    readonly byTable: ReadonlyMap<string, MigrationTableForeignKey[]>;
    readonly absorbed: ReadonlySet<ModelDiffOperation>;
}

/**
 * Fold FK operations into table creation for providers such as SQLite.
 *
 * Direction matters: `createTable`/`addForeignKey` create constraints on the
 * way up, while `dropTable`/`dropForeignKey` recreate them on the way down.
 * Conversely, dropping a table removes its constraints without a separate DDL
 * statement in either direction.
 */
export function inlineForeignKeys(
    builder: MigrationBuilder,
    operations: readonly ModelDiffOperation[],
    direction: 'up' | 'down',
): InlinedForeignKeys {
    if (builder.canAlterTableConstraints) {
        return {
            byTable: new Map<string, MigrationTableForeignKey[]>(),
            absorbed: new Set<ModelDiffOperation>(),
        };
    }

    return planForeignKeyInlining(operations, direction);
}

/** Plan portable inline constraints without consulting a runtime provider. */
export function planForeignKeyInlining(
    operations: readonly ModelDiffOperation[],
    direction: 'up' | 'down',
): InlinedForeignKeys {
    const byTable: Map<string, MigrationTableForeignKey[]> = new Map();
    const absorbed: Set<ModelDiffOperation> = new Set();
    const createTableKind = direction === 'up' ? 'createTable' : 'dropTable';
    const dropTableKind = direction === 'up' ? 'dropTable' : 'createTable';
    const addForeignKeyKind = direction === 'up'
        ? 'addForeignKey'
        : 'dropForeignKey';
    const dropForeignKeyKind = direction === 'up'
        ? 'dropForeignKey'
        : 'addForeignKey';
    const createdTables = tableKeys(operations, createTableKind);
    const droppedTables = tableKeys(operations, dropTableKind);

    for (const operation of operations) {
        const tableKey = operationTableKey(operation);
        if (operation.kind === addForeignKeyKind && createdTables.has(tableKey)) {
            const foreignKey = operation;
            const existing = byTable.get(tableKey) ?? [];
            existing.push({
                name: foreignKey.name,
                columns: foreignKey.columns,
                principalTableName: foreignKey.principalTableName,
                principalSchemaName: foreignKey.principalSchemaName,
                principalColumns: foreignKey.principalColumns,
                onDelete: foreignKey.onDelete,
            });
            byTable.set(tableKey, existing);
            absorbed.add(operation);
            continue;
        }

        if (operation.kind === dropForeignKeyKind && droppedTables.has(tableKey)) {
            absorbed.add(operation);
        }
    }

    return { byTable, absorbed };
}

export function operationTableKey(operation: ModelDiffOperation): string {
    const tableName = (operation as { tableName?: string }).tableName ?? '';
    const schemaName = (operation as { schemaName?: string }).schemaName ?? '';
    return `${schemaName}.${tableName}`;
}

function tableKeys(
    operations: readonly ModelDiffOperation[],
    kind: 'createTable' | 'dropTable',
): Set<string> {
    return new Set(
        operations
            .filter(operation => operation.kind === kind)
            .map(operationTableKey),
    );
}
