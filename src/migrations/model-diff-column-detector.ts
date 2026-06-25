import type { EntitySnapshot } from '../model/model-snapshot-types';
import type { MigrationColumnDefinition } from './migration-builder';
import type { ModelDiffOperation } from './model-diff-operations';
import { toColumnDefinition } from './model-diff-helpers';

/**
 * Column detection: add, alter, and drop operations for the columns of an
 * entity that exists in both snapshots.
 *
 * Kept separate because a column diff is keyed on the *column* name (not the
 * property), and an alter carries the previous type/nullability/default so the
 * down migration can restore it — concerns that are irrelevant to the table,
 * index, foreign-key, and join-table facets and would otherwise crowd them.
 */
export function diffColumns(from: EntitySnapshot, to: EntitySnapshot): ModelDiffOperation[] {
    const operations: ModelDiffOperation[] = [];
    const fromColumns = new Map(from.properties.map(property => [property.columnName, property]));
    const toColumns = new Map(to.properties.map(property => [property.columnName, property]));

    for (const property of to.properties) {
        const previous = fromColumns.get(property.columnName);
        if (!previous) {
            operations.push({
                kind: 'addColumn',
                entityName: to.entityName,
                tableName: to.tableName,
                schemaName: to.schemaName,
                column: toColumnDefinition(property),
            });
            continue;
        }

        const previousColumn = toColumnDefinition(previous);
        const nextColumn = toColumnDefinition(property);
        if (!sameColumnDefinition(previousColumn, nextColumn)) {
            operations.push({
                kind: 'alterColumn',
                entityName: to.entityName,
                tableName: to.tableName,
                schemaName: to.schemaName,
                column: {
                    ...nextColumn,
                    oldType: previousColumn.type,
                    oldNullable: previousColumn.nullable,
                    oldDefaultSql: previousColumn.defaultSql,
                    oldComputedSql: previousColumn.computedSql,
                    oldComputedStored: previousColumn.computedStored,
                    oldCollation: previousColumn.collation,
                    oldStoreGeneration: previousColumn.storeGeneration,
                },
            });
        }
    }

    for (const property of from.properties) {
        if (!toColumns.has(property.columnName)) {
            operations.push({
                kind: 'dropColumn',
                entityName: from.entityName,
                tableName: from.tableName,
                schemaName: from.schemaName,
                columnName: property.columnName,
                column: toColumnDefinition(property),
            });
        }
    }

    return operations;
}

function sameColumnDefinition(left: MigrationColumnDefinition, right: MigrationColumnDefinition): boolean {
    return left.name === right.name &&
    left.type === right.type &&
    left.nullable === right.nullable &&
    left.primaryKey === right.primaryKey &&
    left.defaultSql === right.defaultSql &&
    left.computedSql === right.computedSql &&
    left.computedStored === right.computedStored &&
    left.collation === right.collation &&
    JSON.stringify(left.storeGeneration) === JSON.stringify(right.storeGeneration);
}
