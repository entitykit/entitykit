import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import type { PropertyMetadata } from '../model/property-metadata';
import { readPropertyValue, writePropertyValue } from '../model/property-value-access';
import { snapshotPropertyValueCopies, snapshotPropertyValuesEqual } from '../tracking/snapshot-value';

interface TenantWriteScope {
    readonly entityName: string;
    readonly tenantProperty: string;
    readonly property: PropertyMetadata;
    readonly readValue: () => unknown;
    readonly writeValue: (value: unknown) => unknown;
    readonly isAdded: boolean;
    readonly tenantId: unknown;
    readonly allowsCrossTenantAccess: boolean;
    readonly recordMutation: (applied: unknown) => void;
    readonly mirrorMutation?: (value: unknown) => unknown;
}

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
    const previousLiveValue = readPropertyValue(entry.entity, property);
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
    const previousTenantId = readPropertyValue(entity, property);
    let rollback = (): void => undefined;
    applyTenantWriteScope({
        entityName: metadata.entityName,
        tenantProperty,
        property,
        readValue: () => readPropertyValue(entity, property),
        writeValue: value => {
            writePropertyValue(entity, property, value);
            return readPropertyValue(entity, property);
        },
        isAdded: true,
        tenantId: currentTenantId(),
        allowsCrossTenantAccess,
        recordMutation: () => {
            rollback = () => {
                writePropertyValue(entity, property, previousTenantId);
            };
        },
    });
    return rollback;
}

function applyTenantWriteScope(scope: TenantWriteScope): void {
    const {
        entityName,
        tenantProperty,
        property,
        readValue,
        writeValue,
        isAdded,
        tenantId,
        allowsCrossTenantAccess,
        recordMutation,
        mirrorMutation,
    } = scope;
    if (allowsCrossTenantAccess) {
        return;
    }
    if (tenantId === undefined || tenantId === null) {
        throw new TenantScopeUnavailableError(entityName);
    }

    if (isAdded && isEmptyTenantValue(readValue())) {
        const copies = snapshotPropertyValueCopies(
            tenantId,
            property.converter,
            `${entityName}.${tenantProperty}`,
        );
        const written = writeValue(mirrorMutation
            ? copies.persistedValue
            : copies.liveValue);
        const applied = mirrorMutation?.(copies.liveValue) ?? written;
        recordMutation(applied);
    }

    if (!snapshotPropertyValuesEqual(
        readValue(),
        tenantId,
        property.converter,
        `${entityName}.${tenantProperty}`,
    )) {
        throw new DbValidationError(
            `Entity '${entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
        );
    }
}

function isEmptyTenantValue(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}
