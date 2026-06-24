import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import type { Model } from '../model/model';
import { defaultForeignKeyName } from '../sql/identifiers';
import type { SqlDialect } from '../sql/sql-dialect';
import { buildColumnType } from './column-type';

export function buildManyToManyJoinTables(
    model: Model,
    dialect: SqlDialect,
): string[] {
    const seen: Set<string> = new Set();
    const statements: string[] = [];

    for (const entity of model.entities) {
        for (const relationship of entity.manyToManyRelationships) {
            const key = `${relationship.joinSchemaName ?? ''}.${relationship.joinTableName}`;
            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            statements.push(buildJoinTable(entity, relationship, model, dialect));
        }
    }

    return statements;
}

function buildJoinTable(
    source: EntityMetadata,
    relationship: ManyToManyMetadata,
    model: Model,
    dialect: SqlDialect,
): string {
    const target = model.getEntity(relationship.targetEntity);
    const sourceKeys = source.keyPropertiesMetadata;
    const targetKeys = target.keyPropertiesMetadata;
    const sourceColumns = relationship.sourceForeignKeyColumns;
    const targetColumns = relationship.targetForeignKeyColumns;

    assertJoinColumnArity(
        relationship, 'source', source, sourceColumns, sourceKeys.length,
    );
    assertJoinColumnArity(
        relationship, 'target', target, targetColumns, targetKeys.length,
    );

    const quoted = (columns: readonly string[]): string =>
        columns.map(column => dialect.quoteIdentifier(column)).join(', ');
    const sourceConstraint =
        relationship.sourceConstraintName
    ?? defaultForeignKeyName(
        relationship.joinTableName, source.tableName, sourceColumns,
    );
    const targetConstraint =
        relationship.targetConstraintName
    ?? defaultForeignKeyName(
        relationship.joinTableName, target.tableName, targetColumns,
    );
    const lines = [
        ...sourceColumns.map(
            (column, index) =>
                `  ${dialect.quoteIdentifier(column)} `
        + `${buildColumnType(sourceKeys[index], true, dialect)} not null`,
        ),
        ...targetColumns.map(
            (column, index) =>
                `  ${dialect.quoteIdentifier(column)} `
        + `${buildColumnType(targetKeys[index], true, dialect)} not null`,
        ),
        `  ${relationship.primaryKeyName
            ? `constraint ${dialect.quoteIdentifier(relationship.primaryKeyName)} `
            : ''}primary key (${quoted([...sourceColumns, ...targetColumns])})`,
        [
            `  constraint ${dialect.quoteIdentifier(sourceConstraint)}`,
            `foreign key (${quoted(sourceColumns)})`,
            `references ${dialect.quoteQualifiedIdentifier(
                source.schemaName, source.tableName,
            )} (${quoted(sourceKeys.map(key => key.columnName))})`,
            `on delete ${relationship.deleteBehavior}`,
        ].join(' '),
        [
            `  constraint ${dialect.quoteIdentifier(targetConstraint)}`,
            `foreign key (${quoted(targetColumns)})`,
            `references ${dialect.quoteQualifiedIdentifier(
                target.schemaName, target.tableName,
            )} (${quoted(targetKeys.map(key => key.columnName))})`,
            `on delete ${relationship.deleteBehavior}`,
        ].join(' '),
    ];

    return `create table if not exists ${dialect.quoteQualifiedIdentifier(
        relationship.joinSchemaName, relationship.joinTableName,
    )} (\n${lines.join(',\n')}\n);`;
}

function assertJoinColumnArity(
    relationship: ManyToManyMetadata,
    side: 'source' | 'target',
    entity: EntityMetadata,
    columns: readonly string[],
    keyColumnCount: number,
): void {
    if (columns.length !== keyColumnCount) {
        throw new Error(
            `Many-to-many join table '${relationship.joinTableName}' declares `
      + `${String(columns.length)} ${side} foreign key column(s), but `
      + `'${entity.entityName}' has a key of ${String(keyColumnCount)} column(s) `
      + `(${entity.keyProperties.join(', ')}).`,
        );
    }
}
