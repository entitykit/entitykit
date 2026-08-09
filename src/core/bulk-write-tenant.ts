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
import { ensurePolicyPropertyPath } from './policy-property-path';
import { SaveTimeMutationLog } from './save-time-mutations';

/** Apply the tenant boundary to one set-based entity write. */
export function applyBulkWriteTenant<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
): () => void {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || allowsCrossTenantAccess) {
        return () => undefined;
    }
    if (tenantId === undefined || tenantId === null) {
        throw new TenantScopeUnavailableError(metadata.entityName);
    }

    const property = metadata.getProperty(tenantProperty);
    let current = readPropertyValue(entity, property);
    const mutations = new SaveTimeMutationLog();
    if (current === undefined || current === null || current === '') {
        try {
            const context = `${metadata.entityName}.${tenantProperty}`;
            const { liveValue } = snapshotPropertyValueCopies(
                tenantId,
                property.converter,
                context,
            );
            ensurePolicyPropertyPath(
                metadata,
                entity,
                property,
                mutations,
            );
            writePropertyValue(entity, property, liveValue);
            const previous = current;
            current = readPropertyValue(entity, property);
            mutations.recordApplied(
                entity,
                property,
                previous,
                current,
                context,
            );
        } catch (error) {
            mutations.restore();
            throw error;
        }
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
    return () => {
        mutations.restore();
    };
}
