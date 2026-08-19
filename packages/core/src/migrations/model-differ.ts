import type { ModelSnapshot } from '../model/model-snapshot-types';
import type { Migration } from './migration';
import { diffColumns } from './model-diff-column-detector';
import { createForeignKeyOperation, diffForeignKeys, dropForeignKeyOperation } from './model-diff-foreign-key-detector';
import { entityKey } from './model-diff-helpers';
import { createIndexOperation, diffIndexes, dropIndexOperation } from './model-diff-index-detector';
import { diffManyToManyJoinTables } from './model-diff-join-table-detector';
import { SnapshotDiffMigration } from './model-diff-migrations';
import type { ModelDiffOperation } from './model-diff-operations';
import { applyRenameHints, type ModelDiffRenameHints } from './model-diff-rename-hints';
import { createTableOperation, dropTableOperation } from './model-diff-table-detector';
import { diffCheckConstraints } from './model-diff-check-detector';
import { diffSequences } from './model-diff-sequence-detector';
import { addSqliteRebuildOperations } from './model-diff-sqlite-rebuild';

export type { ModelDiffOperation } from './model-diff-operations';
export type { ModelDiffRenameHints } from './model-diff-rename-hints';
export {
    describeModelDiffOperation,
    isDestructiveModelDiffOperation,
} from './model-diff-operation-description';
export { ModelDiffMigration, migrationFromOperations } from './model-diff-migrations';

/** Public contract for model diff. */ export interface ModelDiff {
    /** The operations. */ readonly operations: readonly ModelDiffOperation[];
    /** Whether changes. */ readonly hasChanges: boolean;
    /** Perform the to migration operation. */ toMigration(id: string, name: string): Migration;
}

/** Options that configure model diff. */ export interface ModelDiffOptions {
    /** The rename hints. */ readonly renameHints?: ModelDiffRenameHints;
}

/** Perform the diff model snapshots operation. */ export function diffModelSnapshots(from: ModelSnapshot, to: ModelSnapshot, options: ModelDiffOptions = {}): ModelDiff {
    const prepared = applyRenameHints(from, to, options.renameHints);
    const operations = [
        ...prepared.renameOperations,
        ...buildDiffOperations(prepared.snapshot, to),
    ];
    return {
        operations,
        hasChanges: operations.length > 0,
        /** Perform the to migration operation. */ toMigration(id: string, name: string): Migration {
            return new SnapshotDiffMigration(
                id,
                name,
                addSqliteRebuildOperations(operations, from, to),
            );
        },
    };
}

/**
 * Orchestrate the per-facet detectors over a snapshot pair.
 *
 * The entity add/remove loop owns whole-table changes and captures the indexes
 * and foreign keys that a reverse migration must restore. The facet detectors
 * handle entities present in both snapshots. Operations are produced here and
 * then reordered into safe dependency phases before being returned.
 */
function buildDiffOperations(from: ModelSnapshot, to: ModelSnapshot): ModelDiffOperation[] {
    const operations: ModelDiffOperation[] = [...diffSequences(from, to)];
    const fromEntities = new Map(from.entities.map(entity => [entityKey(entity), entity]));
    const toEntities = new Map(to.entities.map(entity => [entityKey(entity), entity]));
    const fromEntitiesByName = new Map(from.entities.map(entity => [entity.entityName, entity]));
    const toEntitiesByName = new Map(to.entities.map(entity => [entity.entityName, entity]));

    for (const entity of to.entities) {
        if (entity.isView) {
            continue;
        }
        const previous = fromEntities.get(entityKey(entity));
        if (previous?.isView) {
            // Views are outside migration ownership. Changing a mapping between
            // a view and a table needs explicit SQL because the model has no view
            // definition from which to generate a safe replacement.
            continue;
        }
        if (!previous) {
            operations.push(createTableOperation(entity));
            operations.push(...entity.indexes.map(index => createIndexOperation(entity, index)));
            operations.push(...entity.relationships.map(relationship => createForeignKeyOperation(entity, relationship, toEntitiesByName)));
            continue;
        }

        operations.push(...diffColumns(previous, entity));
        operations.push(...diffIndexes(previous, entity));
        operations.push(...diffForeignKeys(previous, entity, fromEntitiesByName, toEntitiesByName));
        operations.push(...diffCheckConstraints(previous, entity));
    }

    const joinTableOperations = diffManyToManyJoinTables(from, to, fromEntitiesByName, toEntitiesByName);
    operations.push(...joinTableOperations.filter(operation => operation.kind === 'dropJoinTable'));

    for (const entity of from.entities) {
        if (entity.isView) {
            continue;
        }
        const replacement = toEntities.get(entityKey(entity));
        if (replacement?.isView) {
            continue;
        }
        if (!replacement) {
            operations.push(...entity.relationships.map(relationship => dropForeignKeyOperation(entity, relationship, fromEntitiesByName)));
            operations.push(...entity.indexes.map(index => dropIndexOperation(entity, index)));
            operations.push(dropTableOperation(entity));
        }
    }

    operations.push(...joinTableOperations.filter(operation => operation.kind === 'createJoinTable'));

    return orderOperationsByDependency(operations);
}

/**
 * Operation phases, ordered so that every operation runs against a database
 * state that can support it.
 *
 * Operations are built per entity, so without this a dependent entity that
 * sorts before its principal would add a foreign key referencing a table that
 * does not exist yet, and a dropped principal could lose its table before a
 * dependent's foreign key was dropped.
 */
const operationPhases: Record<ModelDiffOperation['kind'], number> = {
    dropForeignKey: 0,
    dropCheckConstraint: 1,
    dropJoinTable: 2,
    dropIndex: 3,
    renameTable: 4,
    createSequence: 5,
    alterSequence: 6,
    createTable: 7,
    addColumn: 8,
    alterColumn: 9,
    dropColumn: 10,
    createIndex: 11,
    createJoinTable: 12,
    addCheckConstraint: 13,
    addForeignKey: 14,
    dropTable: 15,
    dropSequence: 16,
    rebuildTable: 14,
};

function orderOperationsByDependency(operations: readonly ModelDiffOperation[]): ModelDiffOperation[] {
    // Stable, so operations within a phase keep the order they were built in.
    return [...operations].sort((left, right) => operationPhases[left.kind] - operationPhases[right.kind]);
}
