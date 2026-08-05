import { DbValidationError } from '../errors/entity-kit-error';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { EntityMetadata } from '../model/entity-metadata';
import {
    readPropertyValue,
    writePropertyValue,
} from '../model/property-value-access';
import {
    snapshotPropertyValueCopies,
    snapshotPropertyValuesEqual,
} from '../tracking/snapshot-value';

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

    const property = metadata.getProperty(tenantProperty);
    const current = readPropertyValue(entity, property);
    if (current === undefined || current === null || current === '') {
        const { liveValue } = snapshotPropertyValueCopies(
            tenantId,
            property.converter,
            `${metadata.entityName}.${tenantProperty}`,
        );
        writePropertyValue(entity, property, liveValue);
        return;
    }

    if (!snapshotPropertyValuesEqual(
        current,
        tenantId,
        property.converter,
        `${metadata.entityName}.${tenantProperty}`,
    )) {
        throw new DbValidationError(
            `Entity '${metadata.entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
        );
    }
}
