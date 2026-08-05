import type { EntityMetadata } from './entity-metadata';
import { encodeIdentityTuple } from './identity-value';
import { toProviderValue } from './value-converter/store-value';
import type { PropertyMetadata } from './property-metadata';

type ModelValues = Readonly<Record<string, unknown>>;

export interface RelationshipKeyMetadata {
    readonly foreignKeyProperties: readonly string[];
    readonly principalKeyProperties?: readonly string[];
}

export function dependentRelationshipProviderValues<TEntity extends object>(
    relationship: RelationshipKeyMetadata,
    metadata: EntityMetadata<TEntity>,
    values: ModelValues,
): readonly unknown[] {
    return relationship.foreignKeyProperties.map(propertyName => {
        const property = metadata.getProperty(propertyName);
        return propertyProviderValue(metadata, property, values[propertyName]);
    });
}

export function principalRelationshipProviderValues<TEntity extends object>(
    relationship: RelationshipKeyMetadata,
    metadata: EntityMetadata<TEntity>,
    values: ModelValues,
): readonly unknown[] {
    return principalKeyMetadata(relationship, metadata)
        .map(property => propertyProviderValue(
            metadata,
            property,
            values[property.propertyName],
        ));
}

export function dependentRelationshipProviderKey<TEntity extends object>(
    relationship: RelationshipKeyMetadata,
    metadata: EntityMetadata<TEntity>,
    values: ModelValues,
): string {
    return encodeIdentityTuple(
        dependentRelationshipProviderValues(relationship, metadata, values),
    );
}

export function principalRelationshipProviderKey<TEntity extends object>(
    relationship: RelationshipKeyMetadata,
    metadata: EntityMetadata<TEntity>,
    values: ModelValues,
): string {
    return encodeIdentityTuple(
        principalRelationshipProviderValues(relationship, metadata, values),
    );
}

export function relationshipKeyValuesEqual<
    TDependent extends object,
    TPrincipal extends object,
>(
    relationship: RelationshipKeyMetadata,
    dependentMetadata: EntityMetadata<TDependent>,
    dependentValues: ModelValues,
    principalMetadata: EntityMetadata<TPrincipal>,
    principalValues: ModelValues,
): boolean {
    return dependentRelationshipProviderKey(
        relationship,
        dependentMetadata,
        dependentValues,
    ) === principalRelationshipProviderKey(
        relationship,
        principalMetadata,
        principalValues,
    );
}

function propertyProviderValue<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    property: PropertyMetadata,
    value: unknown,
): unknown {
    return toProviderValue(
        value,
        property.converter,
        `${metadata.entityName}.${property.propertyName}`,
    );
}

function principalKeyMetadata<TEntity extends object>(
    relationship: RelationshipKeyMetadata,
    metadata: EntityMetadata<TEntity>,
): readonly PropertyMetadata[] {
    return (relationship.principalKeyProperties ?? metadata.keyProperties)
        .map(propertyName => metadata.getProperty(propertyName));
}
