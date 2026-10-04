import type { EntitySnapshot } from '../model/model-snapshot-types';
import { MigrationError } from '../errors/migration-errors';
import { propertyColumn } from './model-diff-helpers';

/** A column diff cannot express replacement of an existing key constraint. */
export function assertSupportedPrimaryKeyOrder(from: EntitySnapshot, to: EntitySnapshot): void {
    const previousColumns = physicalKeyColumns(from);
    const targetColumns = physicalKeyColumns(to);
    if (previousColumns.length < 2 || previousColumns.length !== targetColumns.length) return;
    if (previousColumns.every((name, index) => name === targetColumns[index])
        || previousColumns.some(name => !targetColumns.includes(name))) return;
    throw new MigrationError(`Primary-key reordering on existing table '${to.tableName}' requires reviewed provider SQL.`, {
        details: { entityName: to.entityName, tableName: to.tableName, schemaName: to.schemaName, previousColumns, targetColumns },
    });
}

function physicalKeyColumns(entity: EntitySnapshot): readonly string[] {
    const properties = entity.keyProperties ?? (entity.keyProperty ? [entity.keyProperty]
        : entity.properties.filter(property => property.isPrimaryKey).map(property => property.propertyName));
    return properties.map(property => propertyColumn(entity, property));
}
