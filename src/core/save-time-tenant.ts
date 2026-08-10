import type { EntityMetadata } from '../model/entity-metadata';
import { EntityState } from '../tracking/entity-state';
import { SaveTimeMutationLog } from './save-time-mutations';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { readPropertyValue, writePropertyValue } from '../model/property-value-access';
import { ensurePolicyPropertyPath } from './policy-property-path';
import { applyTenantWriteScope } from './tenant-write-scope';
import { assertTrackedTenantBoundary } from './tracked-tenant-boundary';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import { DbValidationError } from '../errors/entity-kit-error';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';
import { snapshotValuesEqual } from '../tracking/snapshot-value-equality';

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

export function assertPreparedTenantWrite(
    snapshot: PersistedEntrySnapshot,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
): void {
    const configuredProperty: unknown = snapshot.entry.metadata.tenantKeyProperty;
    const tenantProperty = typeof configuredProperty === 'string'
        ? configuredProperty
        : undefined;
    if (!tenantProperty) {
        return;
    }
    const { entry } = snapshot;
    const property = entry.metadata.getProperty(tenantProperty);
    const entityName = entry.metadata.entityName;
    const boundTenant = captureBoundTenantValue(
        snapshot.values[tenantProperty],
        property,
        entityName,
    );
    snapshot.boundValues[tenantProperty] = boundTenant;

    if (Object.prototype.hasOwnProperty.call(
        entry.originalValues,
        tenantProperty,
    )) {
        snapshot.originalBoundValues[tenantProperty] = captureBoundTenantValue(
            entry.originalValues[tenantProperty],
            property,
            entityName,
        );
    }
    if (allowsCrossTenantAccess) {
        return;
    }
    if (tenantId === undefined || tenantId === null) {
        throw new TenantScopeUnavailableError(entityName);
    }
    const boundScopeTenant = captureBoundTenantValue(
        tenantId,
        property,
        entityName,
    );
    if (!snapshotValuesEqual(boundTenant, boundScopeTenant)) {
        throw new DbValidationError(
            `Entity '${entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
        );
    }
}

function captureBoundTenantValue(
    value: unknown,
    property: Parameters<typeof toBoundPropertyValue>[1],
    entityName: string,
): unknown {
    return cloneSnapshotValue(toBoundPropertyValue(
        value,
        property,
        entityName,
    ));
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
