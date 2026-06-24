import type { EntityMetadata } from '../model/entity-metadata';
import type { Model } from '../model/model';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import {
    defaultForeignKeyName,
    defaultIndexName,
} from '../sql/identifiers';
import type { SqlDialect } from '../sql/sql-dialect';
import { relationshipPrincipalKeyMetadata } from '../model/relationship-key';
import { isAlternateKeyBackingIndex } from '../model/alternate-key-indexes';
import { buildTableColumns } from './table-column-statement';

export function buildCreateTable(
    entity: EntityMetadata,
    model: Model,
    dialect: SqlDialect,
): string {
    const columns = buildTableColumns(entity, dialect);
    const constraints = entity.relationships.map(
        relationship =>
            buildRelationshipConstraint(entity, relationship, model, dialect),
    );
    const keyConstraints = entity.hasCompositeKey
        ? [
            `  primary key (${entity.keyPropertiesMetadata
                .map(property => dialect.quoteIdentifier(property.columnName))
                .join(', ')})`,
        ]
        : [];
    const alternateKeyConstraints = entity.alternateKeys.map(key => {
        const columns = key.propertyNames.map(property =>
            entity.getProperty(property).columnName);
        const matchingIndex = entity.indexes.find(index =>
            isAlternateKeyBackingIndex(index, key.propertyNames));
        const name = key.databaseName ?? matchingIndex?.databaseName ??
            defaultIndexName(true, entity.tableName, columns);
        const included = (matchingIndex?.includedPropertyNames ?? []).map(
            property => dialect.quoteIdentifier(
                entity.getProperty(property).columnName,
            ),
        );
        const includeClause = included.length === 0
            ? ''
            : dialect.indexIncludeClause?.(included);
        if (includeClause === undefined) {
            throw new Error(
                `Covering alternate keys are not supported by the '${dialect.name}' provider.`,
            );
        }
        return `  constraint ${dialect.quoteIdentifier(name)} unique (${columns
            .map(column => dialect.quoteIdentifier(column))
            .join(', ')})${includeClause}`;
    });
    const checkConstraints = entity.checkConstraints.map(check =>
        `  constraint ${dialect.quoteIdentifier(check.name)} check (${check.sql})`,
    );

    return `create table if not exists ${dialect.quoteQualifiedIdentifier(
        entity.schemaName, entity.tableName,
    )} (\n${[
        ...columns,
        ...keyConstraints,
        ...alternateKeyConstraints,
        ...checkConstraints,
        ...constraints,
    ].join(',\n')}\n);`;
}

function buildRelationshipConstraint(
    entity: EntityMetadata,
    relationship: RelationshipMetadata,
    model: Model,
    dialect: SqlDialect,
): string {
    const principal = model.getEntity(relationship.principalEntity);
    const foreignKeyProperties = relationship.foreignKeyProperties.map(
        propertyName => entity.getProperty(propertyName),
    );
    const principalKeys = relationshipPrincipalKeyMetadata(
        relationship,
        principal,
    );

    if (foreignKeyProperties.length !== principalKeys.length) {
        throw new Error(
            `Relationship '${String(relationship.navigationProperty)}' on entity `
      + `'${entity.entityName}' declares ${String(foreignKeyProperties.length)} foreign `
      + `key ${foreignKeyProperties.length === 1 ? 'property' : 'properties'}, `
      + `but principal '${principal.entityName}' has ${String(principalKeys.length)} key `
      + `${principalKeys.length === 1 ? 'property' : 'properties'} `
      + `(${principalKeys.map(property => property.propertyName).join(', ')}).`,
        );
    }

    const constraintName = relationship.constraintName ?? defaultForeignKeyName(
        entity.tableName,
        principal.tableName,
        foreignKeyProperties.map(property => property.columnName),
    );

    return [
        `  constraint ${dialect.quoteIdentifier(constraintName)}`,
        `foreign key (${foreignKeyProperties
            .map(property => dialect.quoteIdentifier(property.columnName))
            .join(', ')})`,
        `references ${dialect.quoteQualifiedIdentifier(
            principal.schemaName, principal.tableName,
        )} (${principalKeys
            .map(property => dialect.quoteIdentifier(property.columnName))
            .join(', ')})`,
        `on delete ${relationship.deleteBehavior}`,
    ].join(' ');
}
