import type { EntityMetadata } from '../model/entity-metadata';
import { encodeIdentityTuple } from '../model/identity-value';
import type { Model } from '../model/model';
import {
    dependentRelationshipBoundKey,
    principalRelationshipBoundKey,
} from '../model/relationship-key-codec';
import type { ChangeTracker } from './change-tracker';
import { changeTrackerAllowsCrossTenantAccess } from './change-tracker-tenant-capability';
import type { EntityEntry } from './entity-entry';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { relationshipBoundValuesFor } from './relationship-detection-values';
import { untrackedPrincipalTargetFacts } from './one-to-one-untracked-target-facts';
import {
    activeTemporaryGeneratedIdentity,
} from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import {
    assertTrackedTargetCanBeAssigned,
    resolveRelationshipTarget,
} from './relationship-target-resolver';

/** Final provider-key target represented by a dependent's captured FK facts. */
export function dependentTargetIdentity(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
): string | undefined {
    const bound = relationshipBoundValuesFor(dependent, captured);
    if (relationship.foreignKeyProperties.some(property =>
        bound[property] === null || bound[property] === undefined,
    )) return undefined;
    const principal = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    const providerTarget = providerIdentity(
        dependentRelationshipBoundKey(relationship, bound),
        tenantScope(
            tracker, dependent.metadata, bound, principal,
        ),
    );
    const resolved = resolveRelationshipTarget(
        tracker, model, dependent, relationship, captured,
    );
    return resolved.kind === 'temporary'
        ? `temporary:${resolved.identity}`
        : providerTarget;
}

/** Persisted provider-key target from the dependent's original snapshot. */
export function originalDependentTargetIdentity(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): string | undefined {
    const bound = dependent.originalBoundValues;
    if (relationship.foreignKeyProperties.some(property =>
        bound[property] === null || bound[property] === undefined,
    )) return undefined;
    return providerIdentity(
        dependentRelationshipBoundKey(relationship, bound),
        tenantScope(
            tracker, dependent.metadata, bound,
            model.getEntity(relationship.principalEntity),
        ),
    );
}

/** Provider-key target for a tracked or untracked principal navigation. */
export function principalTargetIdentity(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: object,
    captured: RelationshipDetectionValues,
): string {
    const metadata = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    const entry = tracker.entry(principal);
    if (entry) {
        assertTrackedTargetCanBeAssigned(dependent, relationship, entry);
        const targetProperties = relationship.principalKeyProperties ??
            metadata.keyProperties;
        const temporary = activeTemporaryGeneratedIdentity(
            entry, targetProperties,
        );
        if (temporary) return `temporary:${temporary.identityKey}`;
        const bound = relationshipBoundValuesFor(entry, captured);
        return providerIdentity(
            principalRelationshipBoundKey(relationship, metadata, bound),
            tenantScope(tracker, metadata, bound, dependent.metadata),
        );
    }
    const bound = untrackedPrincipalTargetFacts(
        metadata, relationship, principal, captured,
    );
    return providerIdentity(
        principalRelationshipBoundKey(relationship, metadata, bound),
        tenantScope(tracker, metadata, bound, dependent.metadata),
    );
}

function tenantScope<TEntity extends object, TCounterpart extends object>(
    tracker: ChangeTracker,
    metadata: EntityMetadata<TEntity>,
    bound: Readonly<Record<string, unknown>>,
    counterpart: EntityMetadata<TCounterpart>,
): unknown {
    if (changeTrackerAllowsCrossTenantAccess(tracker)) return undefined;
    const tenant = metadata.tenantKeyProperty;
    if (
        typeof tenant !== 'string' ||
        typeof counterpart.tenantKeyProperty !== 'string'
    ) return undefined;
    return bound[tenant];
}

function providerIdentity(key: string, tenant: unknown): string {
    return tenant === undefined
        ? `provider:${key}`
        : `provider:${key}:tenant:${encodeIdentityTuple([tenant])}`;
}
