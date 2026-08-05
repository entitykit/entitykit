import type { EntityMetadata } from '../model/entity-metadata';
import { isGeneratedOnAdd } from '../model/value-generated';
import { EntityState } from '../tracking/entity-state';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import {
    temporaryGeneratedIdentity,
} from '../tracking/temporary-generated-identity';
import {
    encodeSaveIdentityTuple,
    toProviderKeyValues,
} from './save-key-values';

export interface CapturedRelationshipEndpoint {
    readonly entity: object;
    readonly metadata: EntityMetadata;
    readonly modelKeyValues: readonly unknown[];
    readonly providerKeyValues: readonly unknown[];
    readonly encodedIdentity: string;
    readonly generatedOnAddPropertyNames: ReadonlySet<string>;
}

export function captureRelationshipEndpoint(
    entity: object,
    metadata: EntityMetadata,
    snapshot: PersistedEntrySnapshot,
    modelKeyValues: readonly unknown[],
): CapturedRelationshipEndpoint {
    const providerKeyValues = toProviderKeyValues(modelKeyValues, metadata);
    const temporary = temporaryGeneratedIdentity(snapshot.entry);
    const activeTemporaryIdentity = temporary?.properties.some(property => {
        const index = metadata.keyProperties.map(String).indexOf(
            property.propertyName,
        );
        return Object.is(
            providerKeyValues[index],
            property.providerValue,
        );
    }) === true
        ? temporary.identityKey
        : undefined;
    return {
        entity,
        metadata,
        modelKeyValues,
        providerKeyValues,
        encodedIdentity: activeTemporaryIdentity ??
            encodeSaveIdentityTuple(providerKeyValues),
        generatedOnAddPropertyNames: new Set(
            snapshot.state === EntityState.Added
                ? metadata.keyPropertiesMetadata
                    .filter(property => isGeneratedOnAdd(
                        property.valueGenerated,
                    ))
                    .map(property => property.propertyName)
                : [],
        ),
    };
}
