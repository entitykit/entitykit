import type {
    EntitySnapshot,
    ModelSnapshot,
} from '../model/model-snapshot-types';
import type { CreateJoinTableOperation, ModelDiffOperation } from './model-diff-operations';
import { createJoinTableOperation } from './model-diff-join-table-operation';
import { joinTableColumnSets } from './model-diff-join-table-columns';

/**
 * Join-table detection: create and drop operations for the tables that back
 * many-to-many relationships.
 *
 * Separate because a join table is a whole-model concern, not a per-entity one:
 * the two ends of a relationship both describe the same physical table, so the
 * facet is deduplicated by table key across the snapshot and compared by a
 * structural signature. That cross-entity collection and signature comparison
 * has no place in the per-entity column/index/foreign-key detectors.
 */
export function diffManyToManyJoinTables(
    from: ModelSnapshot,
    to: ModelSnapshot,
    fromEntitiesByName: ReadonlyMap<string, EntitySnapshot>,
    toEntitiesByName: ReadonlyMap<string, EntitySnapshot>,
): ModelDiffOperation[] {
    const operations: ModelDiffOperation[] = [];
    const fromJoinTables = collectJoinTables(from, fromEntitiesByName);
    const toJoinTables = collectJoinTables(to, toEntitiesByName);

    for (const [key, operation] of fromJoinTables) {
        const next = toJoinTables.get(key);
        if (!next || joinTableSignature(operation) !== joinTableSignature(next)) {
            operations.push({ ...operation, kind: 'dropJoinTable' });
        }
    }

    for (const [key, operation] of toJoinTables) {
        const previous = fromJoinTables.get(key);
        if (!previous || joinTableSignature(previous) !== joinTableSignature(operation)) {
            operations.push(operation);
        }
    }

    return operations;
}

function collectJoinTables(
    snapshot: ModelSnapshot,
    entitiesByName: ReadonlyMap<string, EntitySnapshot>,
): Map<string, CreateJoinTableOperation> {
    const joinTables: Map<string, CreateJoinTableOperation> = new Map();
    for (const entity of snapshot.entities) {
        for (const relationship of entity.manyToManyRelationships ?? []) {
            const operation = createJoinTableOperation(entity, relationship, entitiesByName);
            if (!joinTables.has(joinTableKey(operation))) {
                joinTables.set(joinTableKey(operation), operation);
            }
        }
    }
    return joinTables;
}

function joinTableKey(operation: Pick<CreateJoinTableOperation, 'schemaName' | 'tableName'>): string {
    return `${operation.schemaName ?? ''}.${operation.tableName}`;
}

function joinTableSignature(operation: CreateJoinTableOperation): string {
    const columns = joinTableColumnSets(operation);
    return JSON.stringify({
        columns: operation.columns,
        primaryKeyName: operation.primaryKeyName,
        primaryKeyColumns: operation.primaryKeyColumns,
        sourceTableName: operation.sourceTableName,
        sourceSchemaName: operation.sourceSchemaName,
        sourceColumnNames: columns.sourcePrincipalColumns,
        sourceForeignKeyColumns: columns.sourceColumns,
        sourceConstraintName: operation.sourceConstraintName,
        targetTableName: operation.targetTableName,
        targetSchemaName: operation.targetSchemaName,
        targetColumnNames: columns.targetPrincipalColumns,
        targetForeignKeyColumns: columns.targetColumns,
        targetConstraintName: operation.targetConstraintName,
        deleteBehavior: operation.deleteBehavior,
    });
}
