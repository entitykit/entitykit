import type {
    DatabaseForeignKey,
    DatabaseIndex,
    DatabaseTable,
} from './database-schema';
import type { EntityShape } from './db-pull-codegen-types';
import { tableKey } from './db-pull-emit-helpers';
import { orderedEqual } from '../collections/ordered-equality';

/** Whether a foreign key can identify at most one dependent row. */
export function foreignKeyIsUnique(
    table: DatabaseTable,
    foreignKey: DatabaseForeignKey,
): boolean {
    return sameColumnSet(table.primaryKey?.columns, foreignKey.columns) ||
        table.indexes.some(index =>
            isPlainUniqueIndex(index) &&
            sameColumnSet(index.columns, foreignKey.columns));
}

export interface ForeignKeyTargetKey {
    readonly kind: 'primary' | 'alternate';
    readonly columns: readonly string[];
    readonly properties: readonly string[];
    readonly index?: DatabaseIndex;
}

export function findForeignKeyTargetKey(
    foreignKey: DatabaseForeignKey,
    principal: EntityShape,
): ForeignKeyTargetKey | undefined {
    if (orderedEqual(principal.table.primaryKey?.columns, foreignKey.principalColumns)) {
        return targetKey('primary', foreignKey.principalColumns, principal);
    }
    const index = principal.table.indexes.find(candidate =>
        isPlainUniqueIndex(candidate) &&
        !candidate.unsupportedFeatures?.length &&
        orderedEqual(candidate.columns, foreignKey.principalColumns));
    if (!index) {
        return undefined;
    }
    const alternate = targetKey('alternate', index.columns, principal);
    return alternate ? { ...alternate, index } : undefined;
}

export function referencedAlternateKeyIndexes(
    principal: EntityShape,
    entities: readonly EntityShape[],
): ReadonlySet<DatabaseIndex> {
    const indexes: Set<DatabaseIndex> = new Set();
    for (const dependent of entities) {
        for (const foreignKey of dependent.table.foreignKeys) {
            if (
                tableKey(
                    foreignKey.principalSchemaName,
                    foreignKey.principalTableName,
                ) !== tableKey(
                    principal.table.schemaName,
                    principal.table.tableName,
                )
            ) {
                continue;
            }
            const target = findForeignKeyTargetKey(foreignKey, principal);
            if (target?.kind === 'alternate' && target.index) {
                indexes.add(target.index);
            }
        }
    }
    return indexes;
}

function isPlainUniqueIndex(index: DatabaseIndex): boolean {
    const parts = index.keyParts ?? index.columns.map(name => ({
        kind: 'column' as const,
        name,
    }));
    return index.isUnique &&
        index.filter === undefined &&
        parts.length === index.columns.length &&
        parts.every((part, position) =>
            part.kind === 'column' && part.name === index.columns[position]);
}

function targetKey(
    kind: ForeignKeyTargetKey['kind'],
    columns: readonly string[],
    principal: EntityShape,
): ForeignKeyTargetKey | undefined {
    const properties = columns.map(column =>
        principal.propertiesByColumn.get(column));
    return properties.every((property): property is string => Boolean(property))
        ? { kind, columns, properties }
        : undefined;
}

function sameColumnSet(
    left: readonly string[] | undefined,
    right: readonly string[],
): boolean {
    return left?.length === right.length &&
        right.every(column => left.includes(column));
}
