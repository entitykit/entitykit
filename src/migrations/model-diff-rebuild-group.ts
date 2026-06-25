import type { ModelDiffOperation } from './model-diff-operations';
import { operationKey } from './model-diff-operation-key';

const tableRebuildChangeKinds: ReadonlySet<ModelDiffOperation['kind']> = new Set([
    'addColumn',
    'alterColumn',
    'dropColumn',
    'createIndex',
    'dropIndex',
    'addForeignKey',
    'dropForeignKey',
    'addCheckConstraint',
    'dropCheckConstraint',
]);

/** Whether a provider-level table rebuild replaces this granular operation. */
export function isOperationAbsorbedByRebuild(
    operation: ModelDiffOperation,
    rebuildKeys: ReadonlySet<string>,
): boolean {
    return operation.kind !== 'rebuildTable' &&
        rebuildKeys.has(operationKey(operation)) &&
        tableRebuildChangeKinds.has(operation.kind);
}
