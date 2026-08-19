import type { EntityMetadata } from './entity-metadata';
import type { PropertyMetadata } from './property-metadata';
import { translatePropertyValue } from './property-value-translation';
import type { RelationshipKeyMetadata } from './relationship-key-codec';
import {
    fromProviderValue,
    providerValueFromBoundProperty,
} from './value-converter/store-value';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';

type ModelValues = Readonly<Record<string, unknown>>;

export function principalValuesForDependent<
    TDependent extends object,
    TPrincipal extends object,
>(
    relationship: RelationshipKeyMetadata,
    dependentMetadata: EntityMetadata<TDependent>,
    principalMetadata: EntityMetadata<TPrincipal>,
    principalValues: ModelValues,
): readonly unknown[] {
    const principalProperties = principalKeyMetadata(
        relationship,
        principalMetadata,
    );
    assertMatchingKeyShape(
        relationship.foreignKeyProperties.length,
        principalProperties.length,
    );
    return relationship.foreignKeyProperties.map((propertyName, index) =>
        translatePropertyValue(
            principalValues[principalProperties[index].propertyName],
            principalMetadata,
            principalProperties[index],
            dependentMetadata,
            dependentMetadata.getProperty(propertyName),
        ));
}

export function dependentValuesForPrincipal<
    TDependent extends object,
    TPrincipal extends object,
>(
    relationship: RelationshipKeyMetadata,
    dependentMetadata: EntityMetadata<TDependent>,
    principalMetadata: EntityMetadata<TPrincipal>,
    dependentValues: ModelValues,
): readonly unknown[] {
    const principalProperties = principalKeyMetadata(
        relationship,
        principalMetadata,
    );
    assertMatchingKeyShape(
        relationship.foreignKeyProperties.length,
        principalProperties.length,
    );
    return principalProperties.map((property, index) => translatePropertyValue(
        dependentValues[relationship.foreignKeyProperties[index]],
        dependentMetadata,
        dependentMetadata.getProperty(relationship.foreignKeyProperties[index]),
        principalMetadata,
        property,
    ));
}

export function principalBoundValuesForDependent<
    TDependent extends object,
    TPrincipal extends object,
>(
    relationship: RelationshipKeyMetadata,
    dependentMetadata: EntityMetadata<TDependent>,
    principalMetadata: EntityMetadata<TPrincipal>,
    principalBoundValues: Readonly<Record<string, unknown>>,
): readonly unknown[] {
    const principalProperties = principalKeyMetadata(
        relationship, principalMetadata,
    );
    assertMatchingKeyShape(
        relationship.foreignKeyProperties.length,
        principalProperties.length,
    );
    return relationship.foreignKeyProperties.map((propertyName, index) => {
        const target = dependentMetadata.getProperty(propertyName);
        const source = principalProperties[index];
        return fromProviderValue(
            cloneSnapshotValue(providerValueFromBoundProperty(
                principalBoundValues[source.propertyName], source,
            )),
            target.converter,
            `${dependentMetadata.entityName}.${target.propertyName}`,
        );
    });
}

function principalKeyMetadata<TEntity extends object>(
    relationship: RelationshipKeyMetadata,
    metadata: EntityMetadata<TEntity>,
): readonly PropertyMetadata[] {
    return (relationship.principalKeyProperties ?? metadata.keyProperties)
        .map(propertyName => metadata.getProperty(propertyName));
}

function assertMatchingKeyShape(
    foreignKeyLength: number,
    principalKeyLength: number,
): void {
    if (foreignKeyLength !== principalKeyLength) {
        throw new Error('Relationship key components must have equal lengths.');
    }
}
