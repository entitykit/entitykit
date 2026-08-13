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

export function findTrackedPrincipal(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
): EntityEntry<object> | undefined {
    const values = relationshipValuesFor(dependent, captured);
    const foreignKey = relationship.foreignKeyProperties.map(
        property => values[property],
    );
    if (foreignKey.some(value => value === null || value === undefined)) {
        return undefined;
    }
    const principalMetadata = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    const key = dependentRelationshipBoundKey(
        relationship,
        relationshipBoundValuesFor(dependent, captured),
    );
    return tracker.entries().find(entry =>
        entry.metadata === principalMetadata &&
        tenantsAreCompatible(tracker, dependent, entry) &&
        principalRelationshipBoundKey(
            relationship,
            principalMetadata,
            relationshipBoundValuesFor(entry, captured),
        ) === key);
}

export function findTrackedPrincipalByBoundValues(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    dependentBoundValues: Readonly<Record<string, unknown>>,
): EntityEntry<object> | undefined {
    const foreignKey = relationship.foreignKeyProperties.map(
        property => dependentBoundValues[property],
    );
    if (foreignKey.some(value => value === null || value === undefined)) {
        return undefined;
    }
    const principalMetadata = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    const key = dependentRelationshipBoundKey(
        relationship,
        dependentBoundValues,
    );
    return tracker.entries().find(entry =>
        entry.metadata === principalMetadata &&
        tenantsAreCompatible(tracker, dependent, entry) &&
        principalRelationshipBoundKey(
            relationship,
            principalMetadata,
            entry.originalBoundValues,
        ) === key);
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
    const values = relationshipValuesFor(dependent, captured);
    if (live[relationship.navigationProperty] === principal.entity) {
        return tenantsAreCompatible(tracker, dependent, principal);
    }
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
            model.getEntity<Record<string, unknown>>(
                relationship.principalEntity,
            ),
            relationshipBoundValuesFor(principal, captured),
        );
}

export function relationshipForeignKeyMatchesPrincipal(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
    captured: RelationshipDetectionValues,
): boolean {
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
