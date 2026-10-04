import type { ModelSnapshot } from '../model/model-snapshot-types';
import type { ModelDiffOperation, RebuildTableOperation } from './model-diff-operations';
import { collectJoinTables, joinTableSignature } from './model-diff-join-table-detector';
import { joinTableDefinition } from './model-diff-join-table-definition';
import { normalizeRebuildTableRenames } from './model-diff-sqlite-rebuild-copy';
import { operationKey } from './model-diff-operation-key';

/** Preserve stable join tables whose principals need a different physical reference. */
export function addSqliteJoinRebuildOperations(
    operations: readonly ModelDiffOperation[],
    from: ModelSnapshot,
    to: ModelSnapshot,
): ModelDiffOperation[] {
    const previous = normalizeRebuildTableRenames(from, operations);
    const previousByName = new Map(previous.entities.map(entity => [entity.entityName, entity]));
    from.entities.forEach((entity, index) => previousByName.set(entity.entityName, previous.entities[index]));
    const currentByName = new Map(to.entities.map(entity => [entity.entityName, entity]));
    const previousJoins = collectJoinTables(previous, previousByName);
    const currentJoins = collectJoinTables(to, currentByName);
    const rebuilds: RebuildTableOperation[] = [];
    for (const [key, current] of currentJoins) {
        const old = previousJoins.get(key);
        const explicitlyReplaced = operations.some(operation =>
            (operation.kind === 'createJoinTable' || operation.kind === 'dropJoinTable') && operationKey(operation) === key);
        if (!old || explicitlyReplaced || joinTableSignature(old) === joinTableSignature(current)) continue;
        const copyColumns = current.columns.map(column => ({ source: column.name, target: column.name }));
        rebuilds.push({
            kind: 'rebuildTable',
            entityName: current.entityName,
            tableName: current.tableName,
            schemaName: current.schemaName,
            definition: {
                previous: joinTableDefinition(old),
                current: joinTableDefinition(current),
                copyColumns,
                reverseCopyColumns: copyColumns,
            },
        });
    }
    const insertion = operations.findIndex(operation => operation.kind === 'dropTable' || operation.kind === 'dropSequence');
    return insertion < 0 ? [...operations, ...rebuilds]
        : [...operations.slice(0, insertion), ...rebuilds, ...operations.slice(insertion)];
}
