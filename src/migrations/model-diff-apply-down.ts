import type { MigrationBuilder, MigrationTableForeignKey } from './migration-builder';
import { applyUp } from './model-diff-apply-up';
import { reverseModelDiffOperation } from './model-diff-operation-inverse';
import type { ModelDiffOperation } from './model-diff-operations';

export function applyDown(
    builder: MigrationBuilder,
    operation: ModelDiffOperation,
    inlineForeignKeysForTable?: readonly MigrationTableForeignKey[],
): void {
    applyUp(
        builder,
        reverseModelDiffOperation(operation),
        inlineForeignKeysForTable,
    );
}
