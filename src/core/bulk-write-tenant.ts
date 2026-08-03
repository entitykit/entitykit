import { DbValidationError } from '../errors/entity-kit-error';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { EntityMetadata } from '../model/entity-metadata';

/** Apply the tenant boundary to one set-based entity write. */
export function applyBulkWriteTenant<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
): void {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || allowsCrossTenantAccess) {
        return;
    }
    if (tenantId === undefined || tenantId === null) {
        throw new TenantScopeUnavailableError(metadata.entityName);
    }

    const values = entity as Record<string, unknown>;
    const current = values[tenantProperty];
    if (current === undefined || current === null || current === '') {
        values[tenantProperty] = tenantId;
        return;
    }

    const tenantMatches = current instanceof Date && tenantId instanceof Date
        ? current.getTime() === tenantId.getTime()
        : current === tenantId;
    if (!tenantMatches) {
        throw new DbValidationError(
            `Entity '${metadata.entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
        );
    }
}
