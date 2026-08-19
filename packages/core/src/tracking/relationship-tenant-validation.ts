import { TenantOwnershipError } from '../errors/tenant-ownership-error';
import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import type { ChangeTracker } from './change-tracker';
import { changeTrackerAllowsCrossTenantAccess } from './change-tracker-tenant-capability';
import type { EntityEntry } from './entity-entry';
import { snapshotValuesEqual } from './snapshot-value-equality';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { relationshipBoundValuesFor } from './relationship-detection-values';
import { capturePropertyPersistenceFact } from './entity-persistence-fact-capture';

export function assertRelationshipTenantCompatible(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    principalMetadata: EntityMetadata<Record<string, unknown>>,
    principal: object,
    captured?: RelationshipDetectionValues,
): void {
    if (changeTrackerAllowsCrossTenantAccess(tracker)) return;
    const dependentTenant: unknown = dependent.metadata.tenantKeyProperty;
    const principalTenant: unknown = principalMetadata.tenantKeyProperty;
    if (
        typeof dependentTenant !== 'string' ||
        typeof principalTenant !== 'string'
    ) return;
    const dependentValue = readPropertyValue(
        dependent.entity,
        dependent.metadata.getProperty(dependentTenant),
    );
    const principalValue = readPropertyValue(
        principal,
        principalMetadata.getProperty(principalTenant),
    );
    if (
        dependentValue === null || dependentValue === undefined ||
        principalValue === null || principalValue === undefined ||
        dependentValue === '' || principalValue === ''
    ) return;
    const principalEntry = tracker.entry(principal);
    const dependentBound = captured
        ? relationshipBoundValuesFor(dependent, captured)[dependentTenant]
        : captureBoundTenant(
            dependent.metadata, dependentTenant, dependentValue,
        );
    const principalBound = captured && principalEntry
        ? relationshipBoundValuesFor(principalEntry, captured)[principalTenant]
        : captureBoundTenant(
            principalMetadata, principalTenant, principalValue,
        );
    if (!snapshotValuesEqual(dependentBound, principalBound)) {
        throw new TenantOwnershipError(
            dependent.metadata.entityName,
            dependentTenant,
            'relationship-mismatch',
        );
    }
}

function captureBoundTenant<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    propertyName: string,
    value: unknown,
): unknown {
    return capturePropertyPersistenceFact(
        metadata,
        metadata.getProperty(propertyName),
        value,
    ).boundValue;
}
