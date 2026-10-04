import type { ModelSnapshot } from '../model/model-snapshot-types';
import type { ModelDiffOperation } from './model-diff-operations';
import { collectJoinTables } from './model-diff-join-table-detector';
import { operationKey } from './model-diff-operation-key';

/** Drop replaced joins before renames so rollback restores their original references. */
export function prepareJoinTableRollback(
    operations: readonly ModelDiffOperation[],
    previous: ModelSnapshot,
): readonly ModelDiffOperation[] {
    if (!operations.some(operation => operation.kind === 'renameTable' ||
        operation.kind === 'alterColumn' && operation.column.oldName !== undefined)) return operations;
    const entitiesByName = new Map(previous.entities.map(entity => [entity.entityName, entity]));
    const joins = collectJoinTables(previous, entitiesByName);
    const drops = operations.filter(operation => operation.kind === 'dropJoinTable').map(operation => {
        const original = joins.get(operationKey(operation));
        if (original === undefined) throw new Error(`Cannot restore previous join table '${operation.tableName}'.`);
        return { ...original, kind: 'dropJoinTable' } as const;
    });
    return [...drops, ...operations.filter(operation => operation.kind !== 'dropJoinTable')];
}
