import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { throwIfOperationAborted } from '../storage/operation-cancellation';
import { EntityState } from '../tracking/entity-state';
import { snapshotPropertyValuesEqual } from '../tracking/snapshot-value';
import type { DbSetContext } from './db-set-context';
import { TenantIdentityAmbiguityError } from '../errors/tenant-identity-ambiguity-error';
import type { QueryFilterOperation } from './query-filter-operation';

/** Apply ordinary find boundaries before returning an identity-map candidate. */
export function resolveTrackedFind<TEntity extends object>(
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
    keyValues: readonly unknown[],
    operation: QueryFilterOperation,
    options?: DatabaseOperationOptions,
): TEntity | null | undefined {
    context.assertCanQuery('find()');
    throwIfOperationAborted(options?.signal);

    const tenantId = resolveTenantId(metadata, operation);
    const entry = context.changeTracker.tryGetByIdentityValues(
        metadata,
        keyValues,
        tenantId,
    );
    if (!entry) {
        return undefined;
    }
    if (entry.state === EntityState.Deleted) {
        return null;
    }
    if (metadata.softDelete) {
        const property = metadata.getProperty(metadata.softDelete.propertyName);
        if (readPropertyValue(entry.entity, property) != null) {
            return null;
        }
    }
    if (metadata.tenantKeyProperty && tenantId !== undefined) {
        const property = metadata.getProperty(metadata.tenantKeyProperty);
        if (!snapshotPropertyValuesEqual(
            entry.originalValues[metadata.tenantKeyProperty],
            tenantId,
            property.converter,
        )) {
            return null;
        }
    }
    return entry.entity;
}

function resolveTenantId<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    operation: QueryFilterOperation,
): unknown {
    if (!metadata.tenantKeyProperty || operation.allowsCrossTenantAccess) {
        if (
            metadata.tenantKeyProperty &&
            operation.allowsCrossTenantAccess &&
            !metadata.keyProperties.includes(metadata.tenantKeyProperty)
        ) {
            throw new TenantIdentityAmbiguityError(
                metadata.entityName,
                metadata.tenantKeyProperty,
            );
        }
        return undefined;
    }
    return operation.tenantIdFor(metadata.entityName);
}
