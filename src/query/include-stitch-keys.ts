import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import {
    dependentRelationshipBoundKey,
    principalRelationshipBoundKey,
} from '../model/relationship-key-codec';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ManyToManyRelationshipInfo } from './include-loader-context';
import { parentKeyAliasAt } from './include-loader-sql';
import { encodeIdentityTuple } from '../model/identity-value';
import { readStoreProviderValue } from '../storage/store-value-reader';
import { toBoundProviderValue } from '../model/value-converter/store-value';

export function principalStitchKey<
    TDependent extends object,
    TPrincipal extends object,
>(
    metadata: EntityMetadata<TPrincipal>,
    relationship: RelationshipMetadata<TDependent, TPrincipal>,
    principal: Readonly<Record<string, unknown>>,
): string {
    return principalRelationshipBoundKey(
        relationship,
        metadata,
        principal,
    );
}

export function dependentStitchKey<
    TDependent extends object,
    TPrincipal extends object,
>(
    metadata: EntityMetadata<TDependent>,
    relationship: RelationshipMetadata<TDependent, TPrincipal>,
    dependent: Readonly<Record<string, unknown>>,
): string {
    return dependentRelationshipBoundKey(
        relationship,
        dependent,
    );
}

export function manyToManyRowStitchKey(
    info: ManyToManyRelationshipInfo,
    row: Record<string, unknown>,
    valueReader?: StoreValueReader,
): string {
    return encodeIdentityTuple(
        info.currentMetadata.keyPropertiesMetadata.map((property, index) =>
            toBoundProviderValue(
                readStoreProviderValue(
                    row[parentKeyAliasAt(index)],
                    property,
                    valueReader,
                ),
                property.columnType,
                `${info.currentMetadata.entityName}.${property.propertyName}`,
            )),
    );
}

export function manyToManyEntityStitchKey(
    info: ManyToManyRelationshipInfo,
    values: Readonly<Record<string, unknown>>,
): string {
    return encodeIdentityTuple(info.currentMetadata.keyProperties.map(
        propertyName => values[propertyName],
    ));
}
