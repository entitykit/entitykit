import { encodeIdentityTuple } from '../model/identity-value';
import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import { toProviderValue } from '../model/value-converter/store-value';
import type { EntityEntry } from './entity-entry';

/** Build the identity-map key, adding tenant ownership when it is not a PK part. */
export function createTrackingIdentityKey<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    keyValues: readonly unknown[],
    tenantValue?: unknown,
): string {
    const primary = metadata.createIdentityKeyFromValues(keyValues);
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || metadata.keyProperties.includes(tenantProperty)) {
        return primary;
    }
    const property = metadata.getProperty(tenantProperty);
    const providerValue = toProviderValue(
        tenantValue,
        property.converter,
        `${metadata.entityName}.${tenantProperty}`,
    );
    return `${primary}:tenant:${encodeIdentityTuple([providerValue])}`;
}

export function trackingIdentityKeyForEntry(
    entry: EntityEntry<object>,
    values: Readonly<Record<string, unknown>> = entry.originalValues,
): string {
    return createTrackingIdentityKey(
        entry.metadata,
        entry.metadata.keyProperties.map(propertyName => values[propertyName]),
        tenantIdentityValue(entry.metadata, entry.entity, values),
    );
}

export function tenantIdentityValue<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    values?: Readonly<Record<string, unknown>>,
): unknown {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty) {
        return undefined;
    }
    return values
        ? values[tenantProperty]
        : readPropertyValue(entity, metadata.getProperty(tenantProperty));
}
