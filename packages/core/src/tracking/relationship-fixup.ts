import { DbValidationError } from '../errors/entity-kit-error';
import type { Model } from '../model/model';
import { DeleteBehavior } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { addToRelationshipInverse, removeFromRelationshipInverse } from './relationship-inverse-fixup';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import { clearOptionalRelationshipForeignKey, writeRelationshipForeignKey } from './relationship-foreign-key-write';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { foreignKeyValuesForPrincipal } from './relationship-principal-foreign-key';
import { assertRelationshipTenantCompatible } from './relationship-tenant-validation';
import { detachRelationshipEntry } from './change-tracker-relationship-detection-registry';
import { assertTrackedTargetCanBeAssigned } from './relationship-target-resolver';
import { writeVerifiedNavigation } from './verified-navigation-write';
export function linkDependent(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: object,
    previousPrincipal?: unknown,
    captured?: RelationshipDetectionValues,
    reassigned?: ReadonlySet<EntityEntry<object>>,
): void {
    const principalEntry = tracker.entry(principal);
    if (principalEntry)
        assertTrackedTargetCanBeAssigned(dependent, relationship, principalEntry);
    const values = dependent.entity as Record<string, unknown>;
    const previous = previousPrincipal ?? values[relationship.navigationProperty];
    if (previous && previous !== principal) {
        removeFromRelationshipInverse(
            tracker,
            relationship,
            previous,
            dependent.entity,
        );
    }
    const principalMetadata = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    assertRelationshipTenantCompatible(
        tracker, dependent, principalMetadata, principal, captured,
    );
    const key = foreignKeyValuesForPrincipal(
        dependent,
        relationship,
        principalMetadata,
        principal,
        principalEntry,
        captured,
    );
    writeRelationshipForeignKey(
        dependent,
        relationship.foreignKeyProperties,
        key,
        captured,
    );
    writeVerifiedNavigation(dependent.entity, relationship.navigationProperty, principal, dependent.metadata.entityName);
    addToRelationshipInverse(
        tracker,
        relationship,
        principal,
        dependent,
        previousEntry => {
            if (reassigned?.has(previousEntry)) return;
            severDependent(
                tracker, previousEntry, relationship, principal, captured,
            );
        },
    );
}
export function severDependent(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal?: object,
    captured?: RelationshipDetectionValues,
): void {
    const required = relationship.foreignKeyProperties.every(
        property => dependent.metadata.getProperty(property).isRequired);
    if (required) {
        if (relationship.deleteBehavior !== DeleteBehavior.Cascade) {
            throw new DbValidationError(
                `Required relationship '${dependent.metadata.entityName}.${relationship.navigationProperty}' was severed, but its delete behavior is '${relationship.deleteBehavior}'. Configure Cascade or assign another principal.`,
            );
        }
        if (dependent.state === EntityState.Added) {
            detachRelationshipEntry(tracker, dependent.entity);
        } else {
            dependent.markDeleted();
        }
    } else {
        clearOptionalRelationshipForeignKey(
            dependent,
            relationship.foreignKeyProperties,
            captured,
        );
    }
    const values = dependent.entity as Record<string, unknown>;
    const previous = principal ?? values[relationship.navigationProperty];
    writeVerifiedNavigation(dependent.entity, relationship.navigationProperty, null, dependent.metadata.entityName);
    dependent.markNavigationNotLoaded(relationship.navigationProperty);
    if (previous) {
        removeFromRelationshipInverse(
            tracker,
            relationship,
            previous,
            dependent.entity,
        );
    }
}
export function cascadeDeleteDependent(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: object,
): void {
    if (dependent.state === EntityState.Added) {
        detachRelationshipEntry(tracker, dependent.entity);
    } else {
        dependent.markDeleted();
    }
    writeVerifiedNavigation(dependent.entity, relationship.navigationProperty, null, dependent.metadata.entityName);
    removeFromRelationshipInverse(
        tracker,
        relationship,
        principal,
        dependent.entity,
    );
}
export function clearStaleReference(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): void {
    const values = dependent.entity as Record<string, unknown>;
    const previous = values[relationship.navigationProperty];
    writeVerifiedNavigation(dependent.entity, relationship.navigationProperty, null, dependent.metadata.entityName);
    dependent.markNavigationNotLoaded(relationship.navigationProperty);
    if (previous) {
        removeFromRelationshipInverse(
            tracker,
            relationship,
            previous,
            dependent.entity,
        );
    }
}
