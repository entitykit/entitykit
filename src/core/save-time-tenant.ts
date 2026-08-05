import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';
import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';

interface TenantWriteScope {
    readonly entityName: string;
    readonly tenantProperty: string;
    readonly values: Record<string, unknown>;
    readonly isAdded: boolean;
    readonly tenantId: unknown;
    readonly allowsCrossTenantAccess: boolean;
    readonly recordMutation: () => void;
    readonly mirrorMutation?: (value: unknown) => void;
}

export function applyTenantWrite(
    snapshot: PersistedEntrySnapshot,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
    mutations: SaveTimeMutationLog,
): void {
    const { entry } = snapshot;
    const configuredProperty: unknown = entry.metadata.tenantKeyProperty;
    const tenantProperty = typeof configuredProperty === 'string'
        ? configuredProperty
        : undefined;
    if (!tenantProperty) {
        return;
    }
    const liveValues = entry.entity as Record<string, unknown>;
    applyTenantWriteScope({
        entityName: entry.metadata.entityName,
        tenantProperty,
        values: snapshot.values,
        isAdded: snapshot.state === EntityState.Added,
        tenantId,
        allowsCrossTenantAccess,
        recordMutation: () => {
            mutations.recordCaptured(
                liveValues,
                tenantProperty,
                snapshot.values[tenantProperty],
            );
        },
        mirrorMutation: value => {
            liveValues[tenantProperty] = value;
        },
    });
}

export function applyTenantOnAdd<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    currentTenantId: () => unknown,
    allowsCrossTenantAccess: boolean,
): () => void {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || allowsCrossTenantAccess) {
        return () => undefined;
    }
    const values = entity as Record<string, unknown>;
    const hadTenantProperty = Object.prototype.hasOwnProperty.call(
        values,
        tenantProperty,
    );
    const previousTenantId = values[tenantProperty];
    let rollback = (): void => undefined;

    applyTenantWriteScope({
        entityName: metadata.entityName,
        tenantProperty,
        values,
        isAdded: true,
        tenantId: currentTenantId(),
        allowsCrossTenantAccess,
        recordMutation: () => {
            rollback = () => {
                if (hadTenantProperty) {
                    values[tenantProperty] = previousTenantId;
                } else {
                    Reflect.deleteProperty(values, tenantProperty);
                }
            };
        },
    });
    return rollback;
}

function applyTenantWriteScope(scope: TenantWriteScope): void {
    const {
        entityName,
        tenantProperty,
        values,
        isAdded,
        tenantId,
        allowsCrossTenantAccess,
        recordMutation,
        mirrorMutation,
    } = scope;
    if (allowsCrossTenantAccess) {
        return;
    }
    if (tenantId === undefined || tenantId === null) {
        throw new TenantScopeUnavailableError(entityName);
    }

    if (isAdded && isEmptyTenantValue(values[tenantProperty])) {
        recordMutation();
        values[tenantProperty] = tenantId;
        mirrorMutation?.(tenantId);
    }

    if (!scopedValuesEqual(values[tenantProperty], tenantId)) {
        throw new DbValidationError(
            `Entity '${entityName}' tenant key '${tenantProperty}' must match the current tenant scope.`,
        );
    }
}

function isEmptyTenantValue(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}

/** Dates compare by instant; everything else by identity. */
function scopedValuesEqual(left: unknown, right: unknown): boolean {
    if (left instanceof Date && right instanceof Date) {
        return left.getTime() === right.getTime();
    }

    return left === right;
}
