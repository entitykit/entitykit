import type { ModelDiffOperation } from './model-diff-operations';
import { operationTableKey, physicalTableKey } from './model-diff-foreign-key-inlining';

type TableOperation = Extract<ModelDiffOperation, { kind: 'createTable' | 'dropTable' }>;
type ForeignKeyOperation = Extract<ModelDiffOperation, { kind: 'addForeignKey' | 'dropForeignKey' }>;

/** Keep operation phases intact while ordering tables by their physical FK dependencies. */
export function orderMigrationTables(
    operations: readonly ModelDiffOperation[],
    direction: 'up' | 'down',
): readonly ModelDiffOperation[] {
    const creating = direction === 'up' ? 'createTable' : 'dropTable';
    const dropping = direction === 'up' ? 'dropTable' : 'createTable';
    const foreignKeys = operations.filter((operation): operation is ForeignKeyOperation =>
        operation.kind === 'addForeignKey' || operation.kind === 'dropForeignKey');
    const tables = operations.filter((operation): operation is TableOperation =>
        operation.kind === 'createTable' || operation.kind === 'dropTable');
    const created = orderTables(tables.filter(table => table.kind === creating),
        foreignKeys.filter(key => key.kind === (direction === 'up' ? 'addForeignKey' : 'dropForeignKey')), false);
    const dropped = orderTables(tables.filter(table => table.kind === dropping),
        foreignKeys.filter(key => key.kind === (direction === 'up' ? 'dropForeignKey' : 'addForeignKey')), true);
    let createIndex = 0;
    let dropIndex = 0;
    return operations.map(operation => operation.kind === creating ? created[createIndex++]
        : operation.kind === dropping ? dropped[dropIndex++] : operation);
}

function orderTables(
    tables: readonly TableOperation[],
    foreignKeys: readonly ForeignKeyOperation[],
    dropping: boolean,
): readonly TableOperation[] {
    const dependencies: Map<string, Set<string>> = new Map();
    for (const foreignKey of foreignKeys) {
        const dependent = operationTableKey(foreignKey);
        const principal = physicalTableKey(foreignKey.principalTableName, foreignKey.principalSchemaName);
        if (dependent === principal) continue;
        const owner = dropping ? principal : dependent;
        const prerequisite = dropping ? dependent : principal;
        const required = dependencies.get(owner) ?? new Set<string>();
        required.add(prerequisite);
        dependencies.set(owner, required);
    }
    const pending = [...tables];
    const ordered: TableOperation[] = [];
    while (pending.length > 0) {
        const unresolved = new Set(pending.map(operationTableKey));
        const ready = pending.findIndex(table =>
            [...dependencies.get(operationTableKey(table)) ?? []].every(key => !unresolved.has(key)));
        // Altering providers add cyclic constraints after all tables exist;
        // SQLite accepts forward references in inline table declarations.
        ordered.push(...pending.splice(ready < 0 ? 0 : ready, 1));
    }
    return ordered;
}
