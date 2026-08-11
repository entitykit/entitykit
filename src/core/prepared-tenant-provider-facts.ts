import { DbValidationError } from '../errors/entity-kit-error';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { PropertyMetadata } from '../model/property-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';
import { snapshotValuesEqual } from '../tracking/snapshot-value-equality';
import { EntityState } from '../tracking/entity-state';

/** Validate and retain the exact tenant representations later bound to SQL. */
export function capturePreparedTenantProviderFacts(
    snapshot: PersistedEntrySnapshot,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
): void {
    const configuredProperty: unknown =
        snapshot.entry.metadata.tenantKeyProperty;
    const tenantProperty = typeof configuredProperty === 'string'
        ? configuredProperty
        : undefined;
    if (!tenantProperty) return;

    const { entry } = snapshot;
    const property = entry.metadata.getProperty(tenantProperty);
    const entityName = entry.metadata.entityName;
    const boundTenant = readOrCaptureBoundTenant(
        snapshot.boundValues,
        snapshot.values,
        tenantProperty,
        property,
        entityName,
    );
    if (allowsCrossTenantAccess) return;
    if (tenantId === undefined || tenantId === null) {
        throw new TenantScopeUnavailableError(entityName);
    }

    const boundScopeTenant = captureBoundTenantValue(
        tenantId, property, entityName,
    );
    if (!snapshotValuesEqual(boundTenant, boundScopeTenant)) {
        throw new DbValidationError(
            `Entity '${entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
        );
    }
    if (
        snapshot.state !== EntityState.Added &&
        Object.prototype.hasOwnProperty.call(
            entry.originalValues,
            tenantProperty,
        )
    ) {
        const originalBoundTenant = readOrCaptureBoundTenant(
            snapshot.originalBoundValues,
            entry.originalValues,
            tenantProperty,
            property,
            entityName,
        );
        if (!snapshotValuesEqual(originalBoundTenant, boundScopeTenant)) {
            throw new DbValidationError(
                `Entity '${entityName}' original tenant key '${tenantProperty}' must match the current tenant scope.`,
            );
        }
    }
}

function readOrCaptureBoundTenant(
    boundValues: Record<string, unknown>,
    values: Readonly<Record<string, unknown>>,
    propertyName: string,
    property: PropertyMetadata,
    entityName: string,
): unknown {
    if (Object.prototype.hasOwnProperty.call(boundValues, propertyName)) {
        return boundValues[propertyName];
    }
    const value = captureBoundTenantValue(
        values[propertyName],
        property,
        entityName,
    );
    boundValues[propertyName] = value;
    return value;
}

function captureBoundTenantValue(
    value: unknown,
    property: PropertyMetadata,
    entityName: string,
): unknown {
    return cloneSnapshotValue(toBoundPropertyValue(
        value,
        property,
        entityName,
    ));
}
