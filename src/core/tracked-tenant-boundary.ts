import { TenantOwnershipError } from '../errors/tenant-ownership-error';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { EntityEntry } from '../tracking/entity-entry';
import { snapshotPropertyValuesEqual } from '../tracking/snapshot-value';

/** Validate the persisted tenant identity used by a tracked operation. */
export function assertTrackedTenantBoundary<TEntity extends object>(
    entry: EntityEntry<TEntity>,
    currentTenantId: unknown,
    allowsCrossTenantAccess: boolean,
    currentValues?: Readonly<Record<string, unknown>>,
): void {
    const tenantProperty = entry.metadata.tenantKeyProperty;
    if (!tenantProperty || allowsCrossTenantAccess) {
        return;
    }
    if (currentTenantId === undefined || currentTenantId === null) {
        throw new TenantScopeUnavailableError(entry.metadata.entityName);
    }
    const property = entry.metadata.getProperty(tenantProperty);
    const context = `${entry.metadata.entityName}.${tenantProperty}`;
    const originalTenant = entry.originalValues[tenantProperty];
    if (!snapshotPropertyValuesEqual(
        originalTenant,
        currentTenantId,
        property.converter,
        context,
    )) {
        throw new TenantOwnershipError(
            entry.metadata.entityName,
            tenantProperty,
            'scope-mismatch',
        );
    }
    if (currentValues && !snapshotPropertyValuesEqual(
        currentValues[tenantProperty],
        originalTenant,
        property.converter,
        context,
    )) {
        throw new TenantOwnershipError(
            entry.metadata.entityName,
            tenantProperty,
            'tenant-key-change',
        );
    }
}
