import type { EntityMetadata } from '../model/entity-metadata';
import { isGeneratedOnAdd } from '../model/value-generated';
import { EntityState } from '../tracking/entity-state';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import {
    activeTemporaryGeneratedIdentity,
} from '../tracking/temporary-generated-identity';
import {
    encodeSaveIdentityTuple,
} from './save-key-values';

export interface CapturedRelationshipEndpoint {
    readonly entity: object;
    readonly metadata: EntityMetadata;
    readonly modelKeyValues: readonly unknown[];
    readonly providerKeyValues: readonly unknown[];
    readonly encodedIdentity: string;
    readonly generatedOnAddPropertyNames: ReadonlySet<string>;
    readonly providerTenant?: {
        readonly propertyName: string;
        readonly value: unknown;
    };
}

export function captureRelationshipEndpoint(
    entity: object,
    metadata: EntityMetadata,
    snapshot: PersistedEntrySnapshot,
    modelKeyValues: readonly unknown[],
): CapturedRelationshipEndpoint {
    const providerKeyValues = metadata.keyProperties.map(
        propertyName => snapshot.boundValues[propertyName],
    );
    const activeTemporaryIdentity = activeTemporaryGeneratedIdentity(
        snapshot.entry, metadata.keyProperties.map(String),
    )?.identityKey;
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
        providerTenant: captureProviderTenant(metadata, snapshot),
    };
}

function captureProviderTenant(
    metadata: EntityMetadata,
    snapshot: PersistedEntrySnapshot,
): { readonly propertyName: string; readonly value: unknown } | undefined {
    const propertyName = metadata.tenantKeyProperty as string | undefined;
    if (propertyName === undefined) return undefined;
    return {
        propertyName,
        value: snapshot.state === EntityState.Added
            ? snapshot.boundValues[propertyName]
            : snapshot.originalBoundValues[propertyName],
    };
}
