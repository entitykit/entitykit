import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { throwIfOperationAborted } from '../storage/operation-cancellation';
import { EntityState } from '../tracking/entity-state';
import { snapshotPropertyValuesEqual } from '../tracking/snapshot-value';
import type { DbSetContext } from './db-set-context';
import { createTenantScopeResolver } from './tenant-scope-resolver';
import { TenantIdentityAmbiguityError } from '../errors/tenant-identity-ambiguity-error';

/** Apply ordinary find boundaries before returning an identity-map candidate. */
export function resolveTrackedFind<TEntity extends object>(
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
    keyValues: readonly unknown[],
    options?: DatabaseOperationOptions,
): TEntity | null | undefined {
    context.assertCanQuery('find()');
    throwIfOperationAborted(options?.signal);

    const tenantId = resolveTenantId(context, metadata);
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
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
): unknown {
    if (!metadata.tenantKeyProperty || context.allowsCrossTenantAccess()) {
        if (
            metadata.tenantKeyProperty &&
            context.allowsCrossTenantAccess() &&
            !metadata.keyProperties.includes(metadata.tenantKeyProperty)
        ) {
            throw new TenantIdentityAmbiguityError(
                metadata.entityName,
                metadata.tenantKeyProperty,
            );
        }
        return undefined;
    }
    return createTenantScopeResolver(
        () => context.currentTenantIdForWrites(),
    )(metadata.entityName);
}
