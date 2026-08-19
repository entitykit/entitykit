import { Migration } from './migration';
import type { MigrationBuilder } from './migration-builder';
import { applyDown, applyUp } from './model-diff-apply';
import {
    inlineForeignKeys,
    operationTableKey,
} from './model-diff-foreign-key-inlining';
import type { ModelDiffOperation } from './model-diff-operations';
import { operationKey } from './model-diff-sqlite-rebuild';
import { isOperationAbsorbedByRebuild } from './model-diff-rebuild-group';

/**
 * Running a computed diff as a migration — the execution side, kept apart from
 * the detection that produces the operations.
 *
 * These `Migration` subclasses are the glue between a list of operations and
 * `ModelDiffApply`: they walk the operations in order for `up` and in reverse
 * for `down`, and fold foreign keys into their `create table` for providers
 * that cannot add constraints afterwards. None of that is diffing, so it does
 * not belong beside `diffModelSnapshots`.
 */
export class SnapshotDiffMigration extends Migration {
    constructor(
        public readonly id: string,
        public readonly name: string,
        private readonly operations: readonly ModelDiffOperation[],
    ) {
        super();
    }

    public override up(builder: MigrationBuilder): void {
        applyOperations(builder, this.operations, 'up');
    }

    public override down(builder: MigrationBuilder): void {
        applyOperations(builder, this.operations, 'down');
    }
}

export class ModelDiffMigration extends Migration {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly operations: readonly ModelDiffOperation[],
    ) {
        super();
    }

    public override up(builder: MigrationBuilder): void {
        applyOperations(builder, this.operations, 'up');
    }

    public override down(builder: MigrationBuilder): void {
        applyOperations(builder, this.operations, 'down');
    }
}

function applyOperations(
    builder: MigrationBuilder,
    operations: readonly ModelDiffOperation[],
    direction: 'up' | 'down',
): void {
    // A foreign key folded into `create table` is removed with that table, so
    // a second constraint operation would fail on providers without alter-table support.
    const inlined = inlineForeignKeys(builder, operations, direction);
    const rebuilt = rebuiltTableKeys(builder, operations);
    const ordered = direction === 'up' ? operations : [...operations].reverse();
    const applyOperation = direction === 'up' ? applyUp : applyDown;
    for (const operation of ordered) {
        if (
            inlined.absorbed.has(operation) ||
            isOperationAbsorbedByRebuild(operation, rebuilt)
        ) {
            continue;
        }
        applyOperation(
            builder,
            operation,
            inlined.byTable.get(operationTableKey(operation)),
        );
    }
}

function rebuiltTableKeys(
    builder: MigrationBuilder,
    operations: readonly ModelDiffOperation[],
): ReadonlySet<string> {
    return builder.requiresTableRebuild
        ? new Set(operations
            .filter(operation => operation.kind === 'rebuildTable')
            .map(operationKey))
        : new Set();
}

export function migrationFromOperations(
    id: string,
    name: string,
    operations: readonly ModelDiffOperation[],
): Migration {
    return new ModelDiffMigration(id, name, operations);
}
