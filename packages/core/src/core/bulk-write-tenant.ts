import { DbValidationError } from '../errors/entity-kit-error';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { EntityMetadata } from '../model/entity-metadata';
import {
    readPropertyValue,
} from '../model/property-value-access';
import {
    snapshotPropertyValueCopies,
    snapshotPropertyValuesEqual,
} from '../tracking/snapshot-value';
import { cloneSnapshotValue } from '../tracking/snapshot-value';
import { snapshotValuesEqual } from '../tracking/snapshot-value-equality';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { ensurePolicyPropertyPath } from './policy-property-path';
import { SaveTimeMutationLog } from './save-time-mutations';
import type { RestorationScope } from '../restoration-scope';
import { writeFailureAtomicProperty } from '../failure-atomic-property-write';

/** Apply the tenant boundary to one set-based entity write. */
export function applyBulkWriteTenant<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
    scope: RestorationScope,
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
    try {
        if (current === undefined || current === null || current === '') {
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
                scope,
            );
            current = writeFailureAtomicProperty({
                entity,
                property,
                value: liveValue,
                scope,
                context,
                recordApplied: (previous, applied) => {
                    mutations.recordApplied(
                        entity, property, previous, applied, context,
                    );
                },
            });
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
    } catch (error) {
        scope.capturePrimary(error);
        scope.attempt(mutations.restore.bind(mutations));
        throw error;
    }
}

/** Recheck tenant ownership against the exact row values bound to SQL. */
export function captureBulkWriteTenantProviderValue<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
): unknown {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || allowsCrossTenantAccess) {
        return undefined;
    }
    const property = metadata.getProperty(tenantProperty);
    return cloneSnapshotValue(toBoundPropertyValue(
        tenantId,
        property,
        metadata.entityName,
    ));
}

/** Recheck tenant ownership against the exact provider row bound to SQL. */
export function assertBulkWriteTenantProviderValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    providerValues: Readonly<Record<string, unknown>>,
    providerTenantId: unknown,
    allowsCrossTenantAccess: boolean,
): void {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || allowsCrossTenantAccess) {
        return;
    }
    if (!snapshotValuesEqual(
        providerValues[tenantProperty],
        providerTenantId,
    )) {
        throw new DbValidationError(
            `Entity '${metadata.entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
        );
    }
}
