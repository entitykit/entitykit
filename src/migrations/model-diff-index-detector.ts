import type {
    EntitySnapshot,
    IndexSnapshot,
} from '../model/model-snapshot-types';
import type { CreateIndexOperation, DropIndexOperation, ModelDiffOperation } from './model-diff-operations';
import { defaultIndexName, entityKey, propertyColumn, propertyColumnOrName } from './model-diff-helpers';

/**
 * Index detection: create and drop operations for the indexes of an entity
 * present in both snapshots.
 *
 * Separate because index identity is subtle: it is keyed on the database view
 * (table, name, uniqueness, resolved columns) rather than property names, so a
 * pure TypeScript rename is not mistaken for a different index and needlessly
 * dropped and recreated. That `indexKey` rule is the whole reason this facet
 * earns its own module.
 */
export function diffIndexes(from: EntitySnapshot, to: EntitySnapshot): ModelDiffOperation[] {
    const operations: ModelDiffOperation[] = [];
    const fromIndexes = new Map(from.indexes.map(index => [indexKey(from, index), index]));
    const toIndexes = new Map(to.indexes.map(index => [indexKey(to, index), index]));

    for (const index of from.indexes) {
        if (!toIndexes.has(indexKey(from, index))) {
            operations.push(dropIndexOperation(from, index));
        }
    }

    for (const index of to.indexes) {
        if (!fromIndexes.has(indexKey(to, index))) {
            operations.push(createIndexOperation(to, index));
        }
    }

    return operations;
}

export function createIndexOperation(entity: EntitySnapshot, index: IndexSnapshot): CreateIndexOperation {
    const keyParts = migrationKeyParts(entity, index);
    return {
        kind: 'createIndex',
        entityName: entity.entityName,
        tableName: entity.tableName,
        schemaName: entity.schemaName,
        name: index.databaseName ?? defaultIndexName(entity, index),
        columns: index.propertyNames.map(propertyName => propertyColumn(entity, propertyName)),
        keyParts,
        includedColumns: index.includedPropertyNames?.map(propertyName =>
            propertyColumn(entity, propertyName)),
        filter: index.filter,
        unique: index.isUnique,
    };
}

export function dropIndexOperation(entity: EntitySnapshot, index: IndexSnapshot): DropIndexOperation {
    const keyParts = migrationKeyParts(entity, index);
    return {
        kind: 'dropIndex',
        entityName: entity.entityName,
        schemaName: entity.schemaName,
        name: index.databaseName ?? defaultIndexName(entity, index),
        tableName: entity.tableName,
        columns: index.propertyNames.map(propertyName => propertyColumn(entity, propertyName)),
        keyParts,
        includedColumns: index.includedPropertyNames?.map(propertyName =>
            propertyColumn(entity, propertyName)),
        filter: index.filter,
        unique: index.isUnique,
    };
}

/**
 * Identity of an index as the database sees it: table, name, uniqueness, and
 * columns. Keyed on property names instead, a pure TypeScript rename looked
 * like a different index and produced a drop and a recreate — the same reason
 * `foreignKeyKey` beside it resolves columns.
 */
function indexKey(entity: EntitySnapshot, index: IndexSnapshot): string {
    const keyParts = (index.keyParts ?? index.propertyNames.map(propertyName => ({
        kind: 'property' as const,
        propertyName,
    }))).map(part => part.kind === 'property'
        ? `column:${propertyColumnOrName(entity, part.propertyName)}`
        : `expression:${part.expression}`);
    const included = index.includedPropertyNames?.map(propertyName =>
        propertyColumnOrName(entity, propertyName)) ?? [];
    return `${entityKey(entity)}:${index.databaseName ?? defaultIndexName(entity, index)}:${String(index.isUnique)}:${keyParts.join(',')}:${included.join(',')}:${index.filter ?? ''}`;
}

function migrationKeyParts(
    entity: EntitySnapshot,
    index: IndexSnapshot,
): CreateIndexOperation['keyParts'] {
    return (index.keyParts ?? index.propertyNames.map(propertyName => ({
        kind: 'property' as const,
        propertyName,
    }))).map(part => part.kind === 'property'
        ? { kind: 'column' as const, name: propertyColumn(entity, part.propertyName) }
        : { kind: 'expression' as const, expression: part.expression });
}
