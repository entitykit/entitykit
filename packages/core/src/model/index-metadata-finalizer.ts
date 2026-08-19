import type { EntityConstructor, EntityPropertyKey } from '../types';
import type { AlternateKeyMetadata } from './alternate-key-metadata';
import { mergeAlternateKeyIndexes } from './alternate-key-indexes';
import type { IndexMetadata, MutableIndexMetadata } from './index-metadata';
import type { PropertyMetadata } from './property-metadata';
import { RelationshipCardinality, type RelationshipMetadata } from './relationship-metadata';

export function finalizeIndexes<TEntity extends object>(
    ctor: EntityConstructor<TEntity>,
    configured: ReadonlyArray<MutableIndexMetadata<TEntity>>,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
    relationships: ReadonlyArray<RelationshipMetadata<TEntity>>,
    alternateKeys: ReadonlyArray<AlternateKeyMetadata<TEntity>>,
    keyProperties: ReadonlyArray<EntityPropertyKey<TEntity>>,
): Array<IndexMetadata<TEntity>> {
    const propertyNames: Set<EntityPropertyKey<TEntity>> = new Set(
        properties.map(property =>
            property.propertyName as EntityPropertyKey<TEntity>),
    );
    const indexes = configured.map(index =>
        finalizeConfiguredIndex(ctor, index, propertyNames));
    for (const property of properties) {
        if (property.isUnique && !property.isPrimaryKey) {
            indexes.push({
                propertyNames: [
                    property.propertyName as EntityPropertyKey<TEntity>,
                ],
                isUnique: true,
            });
        }
    }
    for (const relationship of relationships) {
        if (
            relationship.cardinality === RelationshipCardinality.OneToOne &&
            !sameProperties(relationship.foreignKeyProperties, keyProperties) &&
            !indexes.some(index =>
                index.isUnique &&
                sameProperties(index.propertyNames, relationship.foreignKeyProperties))
        ) {
            indexes.push({
                propertyNames: [...relationship.foreignKeyProperties],
                isUnique: true,
            });
        }
    }
    return mergeAlternateKeyIndexes(indexes, alternateKeys);
}

function finalizeConfiguredIndex<TEntity extends object>(
    ctor: EntityConstructor<TEntity>,
    index: MutableIndexMetadata<TEntity>,
    propertyNames: ReadonlySet<EntityPropertyKey<TEntity>>,
): IndexMetadata<TEntity> {
    const seen: Set<EntityPropertyKey<TEntity>> = new Set();
    for (const propertyName of index.propertyNames) {
        if (!propertyNames.has(propertyName)) {
            throw new Error(`Index on entity '${ctor.name}' references unconfigured property '${propertyName}'.`);
        }
        if (seen.has(propertyName)) {
            throw new Error(`Index on entity '${ctor.name}' lists property '${propertyName}' more than once.`);
        }
        seen.add(propertyName);
    }
    const included = index.includedPropertyNames ?? [];
    const includedNames: Set<EntityPropertyKey<TEntity>> = new Set();
    for (const propertyName of included) {
        if (!propertyNames.has(propertyName)) {
            throw new Error(`Included column on entity '${ctor.name}' references unconfigured property '${propertyName}'.`);
        }
        if (includedNames.has(propertyName)) {
            throw new Error(`Included column on entity '${ctor.name}' lists property '${propertyName}' more than once.`);
        }
        if (seen.has(propertyName)) {
            throw new Error(`Included column on entity '${ctor.name}' duplicates index key property '${propertyName}'.`);
        }
        includedNames.add(propertyName);
    }
    if (index.keyParts?.some(part => part.kind === 'expression') && !index.databaseName) {
        throw new Error(`Expression index on entity '${ctor.name}' must configure a database name.`);
    }
    return {
        propertyNames: [...index.propertyNames],
        ...index.keyParts ? { keyParts: [...index.keyParts] } : {},
        ...included.length > 0 ? { includedPropertyNames: [...included] } : {},
        ...index.filter ? { filter: index.filter } : {},
        isUnique: index.isUnique ?? false,
        databaseName: index.databaseName,
    };
}

function sameProperties(left: readonly PropertyKey[], right: readonly PropertyKey[]): boolean {
    return left.length === right.length && left.every(property => right.includes(property));
}
