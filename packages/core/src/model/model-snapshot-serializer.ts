import type { Model } from './model';
import type { ModelSnapshot } from './model-snapshot-types';
import { serializeDefaultValue } from './default-value';
import { ValueGenerated } from './value-generated';
import { RelationshipCardinality } from './relationship-metadata';

export function createModelSnapshot(model: Model): ModelSnapshot {
    return {
        formatVersion: 1,
        sequences: model.sequences.length > 0
            ? [...model.sequences]
                .sort((left, right) =>
                    `${left.schemaName ?? ''}.${left.name}`.localeCompare(
                        `${right.schemaName ?? ''}.${right.name}`,
                    ))
                .map(sequence => ({
                    ...sequence,
                    startValue: serializeInteger(sequence.startValue),
                    incrementBy: serializeInteger(sequence.incrementBy),
                    minValue: serializeInteger(sequence.minValue),
                    maxValue: serializeInteger(sequence.maxValue),
                }))
            : undefined,
        entities: [...model.entities]
            .sort((left, right) => left.entityName.localeCompare(right.entityName))
            .map(entity => ({
                entityName: entity.entityName,
                tableName: entity.tableName,
                schemaName: entity.schemaName,
                isKeyless: entity.isKeyless || undefined,
                isView: entity.isView || undefined,
                keyProperty:
          entity.isKeyless || entity.hasCompositeKey ? undefined : entity.keyProperties[0],
                keyProperties: [...entity.keyProperties],
                alternateKeys: entity.alternateKeys.length > 0
                    ? entity.alternateKeys.map(key => ({
                        propertyNames: [...key.propertyNames],
                        databaseName: key.databaseName,
                    }))
                    : undefined,
                checkConstraints: entity.checkConstraints.length > 0
                    ? entity.checkConstraints.map(check => ({ ...check }))
                    : undefined,
                properties: entity.properties.map(property => ({
                    propertyName: property.propertyName,
                    columnName: property.columnName,
                    columnType: property.columnType,
                    isRequired: property.isRequired,
                    isPrimaryKey: property.isPrimaryKey,
                    isUnique: property.isUnique,
                    maxLength: property.maxLength,
                    defaultValue: serializeDefaultValue(property.defaultValue),
                    defaultSql: property.defaultSql,
                    computedSql: property.computedSql,
                    computedStored: property.computedStored,
                    collation: property.collation,
                    storeGeneration: property.storeGeneration
                        ? { ...property.storeGeneration }
                        : undefined,
                    hasConverter: property.converter !== undefined,
                    isConcurrencyToken: property.isConcurrencyToken,
                    isVersion: property.isVersion,
                    valueGenerated:
            property.valueGenerated === ValueGenerated.Never
                ? undefined
                : property.valueGenerated,
                })),
                ignoredProperties: [...entity.ignoredProperties],
                indexes: entity.indexes.map(index => ({
                    propertyNames: [...index.propertyNames],
                    keyParts: index.keyParts?.some(part => part.kind === 'expression')
                        ? index.keyParts.map(part => ({ ...part }))
                        : undefined,
                    includedPropertyNames: index.includedPropertyNames &&
                    index.includedPropertyNames.length > 0
                        ? [...index.includedPropertyNames]
                        : undefined,
                    filter: index.filter,
                    isUnique: index.isUnique,
                    databaseName: index.databaseName,
                })),
                relationships: entity.relationships.map(relationship => ({
                    navigationProperty: relationship.navigationProperty,
                    principalEntityName: relationship.principalEntity.name,
                    inverseNavigationProperty:
            relationship.inverseNavigationProperty,
                    foreignKeyProperty:
            relationship.foreignKeyProperties.length === 1
                ? relationship.foreignKeyProperties[0]
                : undefined,
                    foreignKeyProperties: [...relationship.foreignKeyProperties],
                    principalKeyProperties:
            relationship.principalKeyProperties
                ? [...relationship.principalKeyProperties]
                : undefined,
                    cardinality:
            relationship.cardinality === RelationshipCardinality.ManyToOne
                ? undefined
                : relationship.cardinality,
                    deleteBehavior: relationship.deleteBehavior,
                    constraintName: relationship.constraintName,
                })),
                audit: entity.audit ? { ...entity.audit } : undefined,
                softDelete:
          entity.softDelete ? { ...entity.softDelete } : undefined,
                tenantKeyProperty: entity.tenantKeyProperty,
                manyToManyRelationships:
          entity.manyToManyRelationships.map(relationship => ({
              navigationProperty: relationship.navigationProperty,
              targetEntityName: relationship.targetEntity.name,
              inverseNavigationProperty:
              relationship.inverseNavigationProperty,
              joinTableName: relationship.joinTableName,
              joinSchemaName: relationship.joinSchemaName,
              primaryKeyName: relationship.primaryKeyName,
              sourceForeignKeyColumn:
              relationship.sourceForeignKeyColumns.length === 1
                  ? relationship.sourceForeignKeyColumns[0]
                  : undefined,
              targetForeignKeyColumn:
              relationship.targetForeignKeyColumns.length === 1
                  ? relationship.targetForeignKeyColumns[0]
                  : undefined,
              sourceForeignKeyColumns:
              [...relationship.sourceForeignKeyColumns],
              targetForeignKeyColumns:
              [...relationship.targetForeignKeyColumns],
              sourceConstraintName: relationship.sourceConstraintName,
              targetConstraintName: relationship.targetConstraintName,
              deleteBehavior: relationship.deleteBehavior,
          })),
            })),
    };
}

function serializeInteger(value: number | bigint | undefined): string | undefined {
    return value === undefined ? undefined : String(value);
}
