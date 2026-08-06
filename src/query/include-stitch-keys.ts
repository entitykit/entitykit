import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import {
    dependentRelationshipProviderKey,
    principalRelationshipProviderKey,
} from '../model/relationship-key-codec';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ManyToManyRelationshipInfo } from './include-loader-context';
import { parentKeyAliasAt } from './include-loader-sql';
import {
    readKeyColumn,
} from './include-key-helpers';
import { propertyTupleLookupKey } from './include-property-key-helpers';

export function principalStitchKey<
    TDependent extends object,
    TPrincipal extends object,
>(
    metadata: EntityMetadata<TPrincipal>,
    relationship: RelationshipMetadata<TDependent, TPrincipal>,
    principal: Readonly<Record<string, unknown>>,
): string {
    return principalRelationshipProviderKey(
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
    dependent: TDependent,
): string {
    return dependentRelationshipProviderKey(
        relationship,
        metadata,
        dependent as Record<string, unknown>,
    );
}

export function manyToManyRowStitchKey(
    info: ManyToManyRelationshipInfo,
    row: Record<string, unknown>,
    valueReader?: StoreValueReader,
): string {
    return propertyTupleLookupKey(
        info.currentMetadata,
        info.currentMetadata.keyProperties.map(String),
        info.currentJoinColumns.map((_, index) => readKeyColumn(
            info.currentMetadata,
            index,
            row[parentKeyAliasAt(index)],
            valueReader,
        )),
    );
}

export function manyToManyEntityStitchKey(
    info: ManyToManyRelationshipInfo,
    values: Readonly<Record<string, unknown>>,
): string {
    return propertyTupleLookupKey(
        info.currentMetadata,
        info.currentMetadata.keyProperties.map(String),
        info.currentMetadata.keyProperties.map(
            propertyName => values[propertyName],
        ),
    );
}
