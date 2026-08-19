import type { Model } from '../model/model';
import {
    dependentRelationshipBoundKey,
    principalRelationshipBoundKey,
} from '../model/relationship-key-codec';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import {
    relationshipBoundValuesFor,
    relationshipValuesFor,
} from './relationship-detection-values';
import { changeTrackerAllowsCrossTenantAccess } from './change-tracker-tenant-capability';
import { snapshotValuesEqual } from './snapshot-value-equality';
import {
    assertTrackedTargetCanBeAssigned,
    resolveRelationshipTarget,
    resolveRelationshipTargetByBoundValues,
} from './relationship-target-resolver';

export function findTrackedPrincipal(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
): EntityEntry<object> | undefined {
    const resolved = resolveRelationshipTarget(
        tracker, model, dependent, relationship, captured,
    );
    return resolved.kind === 'stable' || resolved.kind === 'temporary'
        ? resolved.principal
        : undefined;
}

export function findTrackedPrincipalByBoundValues(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    dependentBoundValues: Readonly<Record<string, unknown>>,
): EntityEntry<object> | undefined {
    const resolved = resolveRelationshipTargetByBoundValues(
        tracker, model, dependent, relationship, dependentBoundValues,
    );
    return resolved.kind === 'stable' || resolved.kind === 'temporary'
        ? resolved.principal
        : undefined;
}

export function relationshipConnects(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
    captured: RelationshipDetectionValues,
): boolean {
    const live = dependent.entity as Record<string, unknown>;
    if (live[relationship.navigationProperty] === principal.entity) {
        assertTrackedTargetCanBeAssigned(dependent, relationship, principal);
        return tenantsAreCompatible(tracker, dependent, principal);
    }
    const resolved = resolveRelationshipTarget(
        tracker, model, dependent, relationship, captured,
    );
    return (resolved.kind === 'stable' || resolved.kind === 'temporary') &&
        resolved.principal === principal;
}

export function relationshipForeignKeyMatchesPrincipal(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
    captured: RelationshipDetectionValues,
): boolean {
    assertTrackedTargetCanBeAssigned(dependent, relationship, principal);
    const values = relationshipValuesFor(dependent, captured);
    const foreignKey = relationship.foreignKeyProperties.map(
        property => values[property],
    );
    return tenantsAreCompatible(tracker, dependent, principal) &&
        !foreignKey.some(value => value === null || value === undefined) &&
        dependentRelationshipBoundKey(
            relationship,
            relationshipBoundValuesFor(dependent, captured),
        ) === principalRelationshipBoundKey(
            relationship,
            principal.metadata,
            relationshipBoundValuesFor(principal, captured),
        );
}

function tenantsAreCompatible(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    principal: EntityEntry<object>,
): boolean {
    if (changeTrackerAllowsCrossTenantAccess(tracker)) return true;
    const dependentTenant: unknown = dependent.metadata.tenantKeyProperty;
    const principalTenant: unknown = principal.metadata.tenantKeyProperty;
    if (
        typeof dependentTenant !== 'string' ||
        typeof principalTenant !== 'string'
    ) return true;
    return snapshotValuesEqual(
        dependent.originalBoundValues[dependentTenant],
        principal.originalBoundValues[principalTenant],
    );
}
