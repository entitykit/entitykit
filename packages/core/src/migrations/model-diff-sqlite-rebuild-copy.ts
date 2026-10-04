import type { EntitySnapshot, ModelSnapshot } from '../model/model-snapshot-types';
import type { MigrationTableCopyColumn } from './migration-builder';
import { operationKey } from './model-diff-operation-key';
import type { ModelDiffOperation } from './model-diff-operations';

export function rebuildCopyColumns(
    from: EntitySnapshot,
    to: EntitySnapshot,
    operations: readonly ModelDiffOperation[],
    tableKey: string,
    direction: 'forward' | 'reverse',
): MigrationTableCopyColumn[] {
    const previous = new Map(from.properties.map(property => [property.propertyName, property]));
    const previousByColumn = new Map(from.properties.map(property => [property.columnName, property]));
    const renames = operations.filter((
        operation,
    ): operation is Extract<ModelDiffOperation, { kind: 'alterColumn' }> =>
        operation.kind === 'alterColumn')
        .filter(operation =>
            Boolean(operation.column.oldName) && operationKey(operation) === tableKey);
    return to.properties.flatMap(property => {
        const rename = renames.find(operation =>
            (direction === 'forward' ? operation.column.name : operation.column.oldName) === property.columnName);
        const otherColumn = rename
            ? direction === 'forward'
                ? rename.column.oldName
                : rename.column.name
            : undefined;
        const source = (otherColumn ? previousByColumn.get(otherColumn) : undefined) ??
            previousByColumn.get(property.columnName) ??
            previous.get(property.propertyName);
        return !source || property.computedSql !== undefined
            ? []
            : [{ source: source.columnName, target: property.columnName }];
    });
}

export function normalizeRebuildTableRenames(
    snapshot: ModelSnapshot,
    operations: readonly ModelDiffOperation[],
): ModelSnapshot {
    const renames = operations.filter(operation => operation.kind === 'renameTable');
    return {
        ...snapshot,
        entities: snapshot.entities.map(entity => {
            const rename = renames.find(operation =>
                operation.tableName === entity.tableName &&
                operation.schemaName === entity.schemaName);
            return rename
                ? { ...entity, entityName: rename.entityName, tableName: rename.newTableName }
                : entity;
        }),
    };
}
