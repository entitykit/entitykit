import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';

export function applyTenantWrite(
    entry: EntityEntry<object>,
    tenantId: unknown,
    mutations: SaveTimeMutationLog,
): void {
    const configuredProperty: unknown = entry.metadata.tenantKeyProperty;
    const tenantProperty = typeof configuredProperty === 'string'
        ? configuredProperty
        : undefined;
    if (!tenantProperty) {
        return;
    }
    if (tenantId === undefined || tenantId === null) {
        throw new TenantScopeUnavailableError(entry.metadata.entityName);
    }

    const values = entry.entity as Record<string, unknown>;
    if (
        entry.state === EntityState.Added &&
    (values[tenantProperty] === undefined ||
      values[tenantProperty] === null ||
      values[tenantProperty] === '')
    ) {
        mutations.record(values, tenantProperty);
        values[tenantProperty] = tenantId;
    }

    if (!scopedValuesEqual(values[tenantProperty], tenantId)) {
        throw new DbValidationError(
            `Entity '${entry.metadata.entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
        );
    }
}

/** Dates compare by instant; everything else by identity. */
function scopedValuesEqual(left: unknown, right: unknown): boolean {
    if (left instanceof Date && right instanceof Date) {
        return left.getTime() === right.getTime();
    }

    return left === right;
}
