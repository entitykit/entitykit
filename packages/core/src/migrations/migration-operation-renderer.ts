import type { ModelDiffOperation } from './model-differ';
import { renderDownOperation } from './migration-down-operation-renderer';
import {
    operationTableKey,
    planForeignKeyInlining,
} from './model-diff-foreign-key-inlining';
import type { MigrationTableForeignKey } from './migration-builder';
import { renderUpOperation } from './migration-up-operation-renderer';
import {
    operationKey,
    reverseRebuild,
} from './model-diff-sqlite-rebuild';
import { isOperationAbsorbedByRebuild } from './model-diff-rebuild-group';

export function renderOperations(
    operations: readonly ModelDiffOperation[],
    direction: 'up' | 'down',
): string[] {
    const inlined = planForeignKeyInlining(operations, direction);
    const rebuildKeys = new Set(operations
        .filter(operation => operation.kind === 'rebuildTable')
        .map(operationKey));
    const lines = operations
        .filter(operation =>
            !inlined.absorbed.has(operation) &&
            !isOperationAbsorbedByRebuild(operation, rebuildKeys))
        .map(operation => operation.kind === 'rebuildTable'
            ? renderRebuildBranch(operation, operations, direction, inlined.byTable)
            : renderOperation(
                operation,
                direction,
                inlined.byTable.get(operationTableKey(operation)),
            ))
        .filter(Boolean);
    return lines.length > 0 ? lines : ['    // No operations.'];
}

function renderOperation(
    operation: ModelDiffOperation,
    direction: 'up' | 'down',
    inlineForeignKeysForTable?: readonly MigrationTableForeignKey[],
): string {
    if (direction === 'down') {
        return renderDownOperation(operation, inlineForeignKeysForTable);
    }
    return renderUpOperation(operation, inlineForeignKeysForTable);
}

function renderRebuildBranch(
    operation: Extract<ModelDiffOperation, { kind: 'rebuildTable' }>,
    operations: readonly ModelDiffOperation[],
    direction: 'up' | 'down',
    inlinedForeignKeys: ReadonlyMap<string, readonly MigrationTableForeignKey[]>,
): string {
    const definition = direction === 'up'
        ? operation.definition
        : reverseRebuild(operation).definition;
    const granular = operations
        .filter(candidate =>
            isOperationAbsorbedByRebuild(
                candidate,
                new Set([operationKey(operation)]),
            ))
        .map(candidate => renderOperation(
            candidate,
            direction,
            inlinedForeignKeys.get(operationTableKey(candidate)),
        ))
        .join('\n');
    return [
        '    if (builder.requiresTableRebuild) {',
        '        // Recreates modeled columns, constraints, and indexes. Preserve custom triggers manually.',
        indent(`builder.rebuildTable(${JSON.stringify(definition, null, 2)});`, 8),
        '    } else {',
        indent(granular, 4),
        '    }',
    ].join('\n');
}

function indent(value: string, spaces: number): string {
    const prefix = ' '.repeat(spaces);
    return value.split('\n').map(line => `${prefix}${line}`).join('\n');
}
