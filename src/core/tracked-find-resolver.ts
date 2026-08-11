import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { throwIfOperationAborted } from '../storage/operation-cancellation';
import { EntityState } from '../tracking/entity-state';
import { snapshotValuesEqual } from '../tracking/snapshot-value-equality';
import type { DbSetContext } from './db-set-context';
import { TenantIdentityAmbiguityError } from '../errors/tenant-identity-ambiguity-error';
import type { QueryFilterOperation } from './query-filter-operation';
import type { BoundFindValues } from './bound-find-values';

/** Apply ordinary find boundaries before returning an identity-map candidate. */
export function resolveTrackedFind<TEntity extends object>(
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
    values: BoundFindValues,
    operation: QueryFilterOperation,
    options?: DatabaseOperationOptions,
): TEntity | null | undefined {
    context.assertCanQuery('find()');
    throwIfOperationAborted(options?.signal);

    assertTenantIdentityUnambiguous(metadata, operation);
    const entry = context.changeTracker.tryGetByBoundIdentityValues(
        metadata,
        values.byProperty,
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
    if (metadata.tenantKeyProperty && !operation.allowsCrossTenantAccess) {
        const tenant = operation.boundTenantFor(metadata);
        if (!tenant || !snapshotValuesEqual(
            entry.originalBoundValues[metadata.tenantKeyProperty],
            tenant.value,
        )) {
            return null;
        }
    }
    return entry.entity;
}

function assertTenantIdentityUnambiguous<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    operation: QueryFilterOperation,
): void {
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
}
