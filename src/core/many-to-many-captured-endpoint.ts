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
import { toBoundPropertyValue } from '../model/value-converter/store-value';

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
    const providerKeyValues = toProviderKeyValues(modelKeyValues, metadata);
    const temporary = temporaryGeneratedIdentity(snapshot.entry);
    const activeTemporaryIdentity =
        snapshot.state === EntityState.Added && temporary
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
        providerTenant: captureProviderTenant(metadata, snapshot),
    };
}

function captureProviderTenant(
    metadata: EntityMetadata,
    snapshot: PersistedEntrySnapshot,
): { readonly propertyName: string; readonly value: unknown } | undefined {
    const propertyName = metadata.tenantKeyProperty as string | undefined;
    if (propertyName === undefined) return undefined;
    const property = metadata.getProperty(propertyName);
    const modelValue = snapshot.state === EntityState.Added
        ? snapshot.values[propertyName]
        : snapshot.entry.originalValues[propertyName];
    return {
        propertyName,
        value: toBoundPropertyValue(
            modelValue,
            property,
            metadata.entityName,
        ),
    };
}
