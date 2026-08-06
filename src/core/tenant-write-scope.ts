import { DbValidationError } from '../errors/entity-kit-error';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { PropertyMetadata } from '../model/property-metadata';
import {
    snapshotPropertyValueCopies,
    snapshotPropertyValuesEqual,
} from '../tracking/snapshot-value';

export interface TenantWriteScope {
    readonly entityName: string;
    readonly tenantProperty: string;
    readonly property: PropertyMetadata;
    readonly readValue: () => unknown;
    readonly writeValue: (value: unknown) => unknown;
    readonly isAdded: boolean;
    readonly tenantId: unknown;
    readonly allowsCrossTenantAccess: boolean;
    readonly recordMutation: (applied: unknown) => void;
    readonly mirrorMutation?: (value: unknown) => unknown;
}

export function applyTenantWriteScope(scope: TenantWriteScope): void {
    if (scope.allowsCrossTenantAccess) {
        return;
    }
    if (scope.tenantId === undefined || scope.tenantId === null) {
        throw new TenantScopeUnavailableError(scope.entityName);
    }

    if (scope.isAdded && isEmptyTenantValue(scope.readValue())) {
        const copies = snapshotPropertyValueCopies(
            scope.tenantId,
            scope.property.converter,
            `${scope.entityName}.${scope.tenantProperty}`,
        );
        const written = scope.writeValue(scope.mirrorMutation
            ? copies.persistedValue
            : copies.liveValue);
        const applied = scope.mirrorMutation?.(copies.liveValue) ?? written;
        scope.recordMutation(applied);
    }

    if (!snapshotPropertyValuesEqual(
        scope.readValue(),
        scope.tenantId,
        scope.property.converter,
        `${scope.entityName}.${scope.tenantProperty}`,
    )) {
        throw new DbValidationError(
            `Entity '${scope.entityName}' tenant key '${scope.tenantProperty}' must match the current tenant scope.`,
        );
    }
}

function isEmptyTenantValue(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}
