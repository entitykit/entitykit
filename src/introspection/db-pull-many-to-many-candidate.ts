import type {
    DatabaseColumn,
    DatabaseForeignKey,
    DatabaseTable,
} from './database-schema';
import { orderedEqual } from '../collections/ordered-equality';

export type JoinTableClassification =
    | { readonly kind: 'pure'; readonly foreignKeys: readonly [DatabaseForeignKey, DatabaseForeignKey] }
    | { readonly kind: 'review' }
    | { readonly kind: 'notJoin' };

/**
 * Recognize only junction tables the many-to-many model can reproduce exactly.
 * Anything structurally join-like but carrying extra semantics remains an
 * explicit entity and gets a review diagnostic.
 */
export function classifyJoinTable(table: DatabaseTable): JoinTableClassification {
    if (table.objectType === 'view' || table.foreignKeys.length !== 2) {
        return { kind: 'notJoin' };
    }
    const foreignKeys = sortForeignKeysByPrimaryKey(table);
    if (!foreignKeysHaveValidShape(foreignKeys)) {
        return { kind: 'notJoin' };
    }
    if (!table.primaryKey) {
        return { kind: 'review' };
    }

    const joinColumns = foreignKeys.flatMap(foreignKey => foreignKey.columns);
    const structurallyPure =
        allDistinct(joinColumns) &&
        orderedEqual(table.primaryKey.columns, joinColumns) &&
        sameStringSet(table.columns.map(column => column.name), joinColumns);
    if (!structurallyPure) {
        return { kind: 'review' };
    }

    const reproducible =
        foreignKeys[0].onDelete.toLowerCase() ===
            foreignKeys[1].onDelete.toLowerCase() &&
        table.columns.every(isPlainRequiredColumn) &&
        (table.checkConstraints?.length ?? 0) === 0 &&
        table.indexes.length === 0;
    return reproducible
        ? { kind: 'pure', foreignKeys }
        : { kind: 'review' };
}

function foreignKeysHaveValidShape(
    foreignKeys: readonly DatabaseForeignKey[],
): foreignKeys is readonly [DatabaseForeignKey, DatabaseForeignKey] {
    return foreignKeys.length === 2 && foreignKeys.every(foreignKey =>
        foreignKey.columns.length > 0 &&
        foreignKey.columns.length === foreignKey.principalColumns.length);
}

function isPlainRequiredColumn(column: DatabaseColumn): boolean {
    return !column.isNullable &&
        column.defaultSql === undefined &&
        column.generatedExpression === undefined &&
        column.storeGeneration === undefined &&
        !column.isStoreGenerated &&
        column.collation === undefined;
}

function sortForeignKeysByPrimaryKey(
    table: DatabaseTable,
): readonly DatabaseForeignKey[] {
    return table.foreignKeys.slice().sort((left, right) =>
        primaryKeyColumnIndex(table, left) -
        primaryKeyColumnIndex(table, right));
}

function primaryKeyColumnIndex(
    table: DatabaseTable,
    foreignKey: DatabaseForeignKey,
): number {
    const firstColumn = foreignKey.columns[0];
    const index = firstColumn
        ? table.primaryKey?.columns.indexOf(firstColumn) ?? -1
        : -1;
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function allDistinct(values: readonly string[]): boolean {
    return new Set(values).size === values.length;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    const rightSet = new Set(right);
    return left.length === right.length &&
        left.every(item => rightSet.has(item));
}
