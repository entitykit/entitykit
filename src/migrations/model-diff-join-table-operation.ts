import type {
    EntitySnapshot,
    ManyToManySnapshot,
} from '../model/model-snapshot-types';
import { defaultForeignKeyName } from '../sql/identifiers';
import type { CreateJoinTableOperation } from './model-diff-operations';
import { renderColumnType } from './model-diff-helpers';
import {
    assertDistinctJoinColumns,
    resolveJoinTableSide,
} from './model-diff-join-table-shape';

/** Build and validate the operation for one snapshotted join table. */
export function createJoinTableOperation(
    source: EntitySnapshot,
    relationship: ManyToManySnapshot,
    entitiesByName: ReadonlyMap<string, EntitySnapshot>,
): CreateJoinTableOperation {
    const target = entitiesByName.get(relationship.targetEntityName);
    if (!target) {
        throw new Error(
            `Many-to-many relationship '${relationship.navigationProperty}' on entity '${source.entityName}' references missing target entity '${relationship.targetEntityName}'.`,
        );
    }

    const sourceSide = resolveJoinTableSide(source, relationship, 'source');
    const targetSide = resolveJoinTableSide(target, relationship, 'target');
    const sourceKeys = sourceSide.keys;
    const targetKeys = targetSide.keys;
    const sourceJoinColumns = sourceSide.columns;
    const targetJoinColumns = targetSide.columns;
    assertDistinctJoinColumns(relationship, [
        ...sourceJoinColumns,
        ...targetJoinColumns,
    ]);

    return {
        kind: 'createJoinTable',
        entityName: source.entityName,
        tableName: relationship.joinTableName,
        schemaName: relationship.joinSchemaName,
        columns: [
            ...sourceJoinColumns.map((name, index) => ({
                name,
                type: renderColumnType(sourceKeys[index]),
                nullable: false,
                primaryKey: false,
                defaultSql: undefined,
            })),
            ...targetJoinColumns.map((name, index) => ({
                name,
                type: renderColumnType(targetKeys[index]),
                nullable: false,
                primaryKey: false,
                defaultSql: undefined,
            })),
        ],
        primaryKeyName:
            relationship.primaryKeyName ?? `pk_${relationship.joinTableName}`,
        primaryKeyColumns: [...sourceJoinColumns, ...targetJoinColumns],
        sourceTableName: source.tableName,
        sourceSchemaName: source.schemaName,
        sourceColumnNames: sourceKeys.map(key => key.columnName),
        sourceForeignKeyColumns: sourceJoinColumns,
        sourceColumnName: sourceKeys[0].columnName,
        sourceForeignKeyColumn: sourceJoinColumns[0],
        sourceConstraintName:
      relationship.sourceConstraintName ??
      defaultForeignKeyName(
          relationship.joinTableName,
          source.tableName,
          sourceJoinColumns,
      ),
        targetTableName: target.tableName,
        targetSchemaName: target.schemaName,
        targetColumnNames: targetKeys.map(key => key.columnName),
        targetForeignKeyColumns: targetJoinColumns,
        targetColumnName: targetKeys[0].columnName,
        targetForeignKeyColumn: targetJoinColumns[0],
        targetConstraintName:
      relationship.targetConstraintName ??
      defaultForeignKeyName(
          relationship.joinTableName,
          target.tableName,
          targetJoinColumns,
      ),
        deleteBehavior: relationship.deleteBehavior,
    };
}
