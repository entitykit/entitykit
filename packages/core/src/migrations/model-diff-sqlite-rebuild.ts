import type {
    ModelSnapshot,
} from '../model/model-snapshot-types';
import type { EntitySnapshot } from '../model/model-snapshot-types';
import type { MigrationTableShape } from './migration-builder';
import { createForeignKeyOperation } from './model-diff-foreign-key-detector';
import { operationKey } from './model-diff-operation-key';
import { entityKey, toColumnDefinition } from './model-diff-helpers';
import { createIndexOperation } from './model-diff-index-detector';
import {
    indexDefinition,
    tableForeignKeyDefinition,
} from './model-diff-operation-definition';
import type {
    ModelDiffOperation,
    RebuildTableOperation,
} from './model-diff-operations';
import {
    normalizeRebuildTableRenames,
    rebuildCopyColumns,
} from './model-diff-sqlite-rebuild-copy';

export function addSqliteRebuildOperations(
    operations: readonly ModelDiffOperation[],
    from: ModelSnapshot,
    to: ModelSnapshot,
): ModelDiffOperation[] {
    const normalizedPrevious = normalizeRebuildTableRenames(from, operations);
    const previous = new Map(normalizedPrevious.entities.map(entity => [entityKey(entity), entity]));
    const current = new Map(to.entities.map(entity => [entityKey(entity), entity]));
    const previousByName = previousEntitiesByName(from, normalizedPrevious);
    const currentByName = new Map(to.entities.map(entity => [entity.entityName, entity]));
    const rebuilds: RebuildTableOperation[] = [];
    for (const [key, entity] of current) {
        const old = previous.get(key);
        if (!old || old.isView || entity.isView || !needsRebuild(operations, key)) {
            continue;
        }
        rebuilds.push({
            kind: 'rebuildTable',
            entityName: entity.entityName,
            tableName: entity.tableName,
            schemaName: entity.schemaName,
            definition: {
                previous: tableShape(old, previousByName),
                current: tableShape(entity, currentByName),
                copyColumns: rebuildCopyColumns(old, entity, operations, key),
                reverseCopyColumns: rebuildCopyColumns(entity, old, operations, key),
            },
        });
    }
    const insertion = operations.findIndex(operation =>
        operation.kind === 'dropTable' || operation.kind === 'dropSequence');
    return insertion < 0
        ? [...operations, ...rebuilds]
        : [
            ...operations.slice(0, insertion),
            ...rebuilds,
            ...operations.slice(insertion),
        ];
}

function previousEntitiesByName(
    original: ModelSnapshot,
    normalized: ModelSnapshot,
): ReadonlyMap<string, EntitySnapshot> {
    const entities = new Map(normalized.entities.map(entity =>
        [entity.entityName, entity]));
    original.entities.forEach((entity, index) => {
        const normalizedEntity = normalized.entities[index];
        entities.set(entity.entityName, normalizedEntity);
    });
    return entities;
}

function needsRebuild(
    operations: readonly ModelDiffOperation[],
    key: string,
): boolean {
    return operations.some(operation =>
        operationKey(operation) === key &&
        (operation.kind === 'alterColumn' ||
            operation.kind === 'dropColumn' ||
            operation.kind === 'addForeignKey' ||
            operation.kind === 'dropForeignKey' ||
            operation.kind === 'addCheckConstraint' ||
            operation.kind === 'dropCheckConstraint' ||
            operation.kind === 'addColumn' &&
                (operation.column.computedSql !== undefined ||
                    operation.column.collation !== undefined ||
                    operation.column.storeGeneration !== undefined ||
                    operation.column.primaryKey)));
}

function tableShape(
    entity: EntitySnapshot,
    entitiesByName: ReadonlyMap<string, EntitySnapshot>,
): MigrationTableShape {
    return {
        tableName: entity.tableName,
        schemaName: entity.schemaName,
        columns: entity.properties.map(toColumnDefinition),
        foreignKeys: entity.relationships.map(relationship =>
            tableForeignKeyDefinition(
                createForeignKeyOperation(entity, relationship, entitiesByName),
            )),
        checkConstraints: (entity.checkConstraints ?? []).map(check => ({ ...check })),
        indexes: entity.indexes.map(index =>
            indexDefinition(createIndexOperation(entity, index))),
    };
}

export function reverseRebuild(
    operation: RebuildTableOperation,
): RebuildTableOperation {
    return {
        ...operation,
        definition: {
            previous: operation.definition.current,
            current: operation.definition.previous,
            copyColumns: operation.definition.reverseCopyColumns,
            reverseCopyColumns: operation.definition.copyColumns,
        },
    };
}

export { operationKey } from './model-diff-operation-key';
