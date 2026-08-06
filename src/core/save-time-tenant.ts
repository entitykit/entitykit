import type { EntityMetadata } from '../model/entity-metadata';
import { EntityState } from '../tracking/entity-state';
import { SaveTimeMutationLog } from './save-time-mutations';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { readPropertyValue, writePropertyValue } from '../model/property-value-access';
import { ensurePolicyPropertyPath } from './policy-property-path';
import { applyTenantWriteScope } from './tenant-write-scope';
import { assertTrackedTenantBoundary } from './tracked-tenant-boundary';

export function applyTenantWrite(
    snapshot: PersistedEntrySnapshot,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
    mutations: SaveTimeMutationLog,
): void {
    const { entry } = snapshot;
    const configuredProperty: unknown = entry.metadata.tenantKeyProperty;
    const tenantProperty = typeof configuredProperty === 'string'
        ? configuredProperty
        : undefined;
    if (!tenantProperty) {
        return;
    }
    const property = entry.metadata.getProperty(tenantProperty);
    let previousLiveValue = readPropertyValue(entry.entity, property);
    if (snapshot.state !== EntityState.Added) {
        assertTrackedTenantBoundary(
            entry,
            tenantId,
            allowsCrossTenantAccess,
            snapshot.values,
        );
    }
    applyTenantWriteScope({
        entityName: entry.metadata.entityName,
        tenantProperty,
        property,
        readValue: () => snapshot.values[tenantProperty],
        writeValue: value => {
            snapshot.values[tenantProperty] = value;
            return value;
        },
        isAdded: snapshot.state === EntityState.Added,
        tenantId,
        allowsCrossTenantAccess,
        recordMutation: applied => {
            mutations.recordApplied(
                entry.entity,
                property,
                previousLiveValue,
                applied,
                `${entry.metadata.entityName}.${tenantProperty}`,
            );
        },
        mirrorMutation: value => {
            ensurePolicyPropertyPath(
                entry.metadata,
                entry.entity,
                property,
                mutations,
            );
            previousLiveValue = readPropertyValue(entry.entity, property);
            writePropertyValue(entry.entity, property, value);
            return readPropertyValue(entry.entity, property);
        },
    });
}

export function applyTenantOnAdd<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    currentTenantId: () => unknown,
    allowsCrossTenantAccess: boolean,
): () => void {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || allowsCrossTenantAccess) {
        return () => undefined;
    }
    const property = metadata.getProperty(tenantProperty);
    let previousTenantId = readPropertyValue(entity, property);
    const mutations = new SaveTimeMutationLog();
    applyTenantWriteScope({
        entityName: metadata.entityName,
        tenantProperty,
        property,
        readValue: () => readPropertyValue(entity, property),
        writeValue: value => {
            ensurePolicyPropertyPath(metadata, entity, property, mutations);
            previousTenantId = readPropertyValue(entity, property);
            writePropertyValue(entity, property, value);
            return readPropertyValue(entity, property);
        },
        isAdded: true,
        tenantId: currentTenantId(),
        allowsCrossTenantAccess,
        recordMutation: applied => {
            mutations.recordApplied(
                entity,
                property,
                previousTenantId,
                applied,
                `${metadata.entityName}.${tenantProperty}`,
            );
        },
    });
    return () => {
        mutations.restore();
    };
}
