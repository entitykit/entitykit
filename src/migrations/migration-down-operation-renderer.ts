import type { ModelDiffOperation } from './model-differ';
import type { MigrationTableForeignKey } from './migration-builder';
import { renderUpOperation } from './migration-up-operation-renderer';
import { reverseModelDiffOperation } from './model-diff-operation-inverse';

export function renderDownOperation(
    operation: ModelDiffOperation,
    inlineForeignKeysForTable?: readonly MigrationTableForeignKey[],
): string {
    return renderUpOperation(
        reverseModelDiffOperation(operation),
        inlineForeignKeysForTable,
    );
}
