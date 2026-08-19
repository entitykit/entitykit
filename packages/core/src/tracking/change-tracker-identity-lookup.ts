import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry } from './entity-entry';
import type { ChangeTrackerRegistry } from './change-tracker-registry';
import {
    createTrackingIdentityKey,
    createTrackingIdentityKeyFromBoundValues,
} from './tracking-identity-key';

export function trackedByIdentity<TEntity extends object>(
    registry: ChangeTrackerRegistry,
    metadata: EntityMetadata<TEntity>,
    keyValues: readonly unknown[],
    tenantValue?: unknown,
): EntityEntry<TEntity> | undefined {
    const key = createTrackingIdentityKey(metadata, keyValues, tenantValue);
    return registry.identities.get(key) as unknown as
        EntityEntry<TEntity> | undefined;
}

export function trackedByBoundIdentity<TEntity extends object>(
    registry: ChangeTrackerRegistry,
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
): EntityEntry<TEntity> | undefined {
    const key = createTrackingIdentityKeyFromBoundValues(metadata, values);
    return registry.identities.get(key) as unknown as
        EntityEntry<TEntity> | undefined;
}
