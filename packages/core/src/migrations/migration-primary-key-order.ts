import type { EntitySnapshot } from '../model/model-snapshot-types';
import type { MigrationColumnDefinition } from './migration-builder-types';
import { propertyColumn } from './model-diff-helpers';

/** Preserve declared key order without changing the physical column layout. */
export function withSnapshotPrimaryKeyOrder(
    entity: EntitySnapshot,
    columns: readonly MigrationColumnDefinition[],
): readonly MigrationColumnDefinition[] {
    const properties = entity.keyProperties ?? (entity.keyProperty ? [entity.keyProperty]
        : entity.properties.filter(property => property.isPrimaryKey).map(property => property.propertyName));
    return withPrimaryKeyOrder(columns, properties.map(property => propertyColumn(entity, property)));
}

export function withPrimaryKeyOrder(
    columns: readonly MigrationColumnDefinition[],
    order: readonly string[],
): readonly MigrationColumnDefinition[] {
    const keys = columns.filter(column => column.primaryKey);
    if (keys.length !== order.length || new Set(order).size !== order.length || order.some(name => !keys.some(key => key.name === name))) {
        throw new Error('Primary-key order must name every primary-key column exactly once.');
    }
    if (keys.every((key, index) => key.name === order[index])) return columns;
    return columns.map(column => column.primaryKey
        ? { ...column, primaryKeyOrdinal: order.indexOf(column.name) } : column);
}

/** Validate explicit ordinals before rendering a table-level primary key. */
export function orderedPrimaryKeyColumns(
    columns: readonly MigrationColumnDefinition[],
): readonly MigrationColumnDefinition[] {
    if (columns.some(column => !column.primaryKey && column.primaryKeyOrdinal !== undefined)) {
        throw new Error('Only primary-key columns may declare primaryKeyOrdinal.');
    }
    const keys = columns.filter(column => column.primaryKey);
    if (keys.every(column => column.primaryKeyOrdinal === undefined)) return keys;
    if (keys.some(column => column.primaryKeyOrdinal === undefined || !Number.isSafeInteger(column.primaryKeyOrdinal)
        || column.primaryKeyOrdinal < 0 || column.primaryKeyOrdinal >= keys.length)
        || new Set(keys.map(column => column.primaryKeyOrdinal)).size !== keys.length) {
        throw new Error('primaryKeyOrdinal must give every key column a unique position from zero.');
    }
    return keys.sort((left, right) => Number(left.primaryKeyOrdinal) - Number(right.primaryKeyOrdinal));
}
