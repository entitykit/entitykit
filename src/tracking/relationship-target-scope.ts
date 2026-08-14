import { encodeIdentityTuple } from '../model/identity-value';
import type { Model } from '../model/model';
import {
    dependentRelationshipBoundKey,
    principalRelationshipBoundKey,
} from '../model/relationship-key-codec';
import type { ChangeTracker } from './change-tracker';
import { changeTrackerAllowsCrossTenantAccess } from './change-tracker-tenant-capability';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export function relationshipTargetIsMissing(
    relationship: TrackedRelationshipMetadata,
    bound: Readonly<Record<string, unknown>>,
): boolean {
    return relationship.foreignKeyProperties.some(property =>
        bound[property] === null || bound[property] === undefined);
}

export function scopedDependentRelationshipTarget(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    bound: Readonly<Record<string, unknown>>,
): string {
    const key = dependentRelationshipBoundKey(relationship, bound);
    const principal = model.getEntity(relationship.principalEntity);
    return tenantScope(
        tracker, dependent, principal.tenantKeyProperty, bound, key,
    );
}

export function scopedPrincipalRelationshipTarget(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
    bound: Readonly<Record<string, unknown>>,
): string {
    const key = principalRelationshipBoundKey(
        relationship, principal.metadata, bound,
    );
    return tenantScope(
        tracker, principal, dependent.metadata.tenantKeyProperty, bound, key,
    );
}

function tenantScope(
    tracker: ChangeTracker,
    entry: EntityEntry<object>,
    counterpartTenant: unknown,
    bound: Readonly<Record<string, unknown>>,
    key: string,
): string {
    const tenant = entry.metadata.tenantKeyProperty;
    if (
        changeTrackerAllowsCrossTenantAccess(tracker) ||
        typeof tenant !== 'string' ||
        typeof counterpartTenant !== 'string'
    ) return key;
    return `${key}:tenant:${encodeIdentityTuple([bound[tenant]])}`;
}
