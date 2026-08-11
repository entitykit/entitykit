import { DbValidationError } from '../errors/entity-kit-error';
import type { Model } from '../model/model';
import { DeleteBehavior } from '../model/relationship-metadata';
import { principalValuesForDependent } from '../model/relationship-key-translation';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import {
    addToRelationshipInverse,
    removeFromRelationshipInverse,
} from './relationship-inverse-fixup';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import {
    clearOptionalRelationshipForeignKey,
    writeRelationshipForeignKey,
} from './relationship-foreign-key-write';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { relationshipValuesFor } from './relationship-detection-values';

export function linkDependent(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: object,
    previousPrincipal?: unknown,
    captured?: RelationshipDetectionValues,
): void {
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
    const principalEntry = tracker.entry(principal);
    const key = principalValuesForDependent(
        relationship,
        dependent.metadata,
        principalMetadata,
        principalEntry
            ? relationshipValuesFor(principalEntry, captured)
            : principal as Record<string, unknown>,
    );
    writeRelationshipForeignKey(
        dependent,
        relationship.foreignKeyProperties,
        key,
        captured?.get(dependent),
    );
    values[relationship.navigationProperty] = principal;
    addToRelationshipInverse(
        tracker,
        relationship,
        principal,
        dependent,
        previousEntry => {
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
            tracker.detach(dependent.entity);
        } else {
            dependent.markDeleted();
        }
    } else {
        clearOptionalRelationshipForeignKey(
            dependent,
            relationship.foreignKeyProperties,
            captured?.get(dependent),
        );
    }
    const values = dependent.entity as Record<string, unknown>;
    const previous = principal ?? values[relationship.navigationProperty];
    values[relationship.navigationProperty] = null;
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
        tracker.detach(dependent.entity);
    } else {
        dependent.markDeleted();
    }
    const values = dependent.entity as Record<string, unknown>;
    values[relationship.navigationProperty] = null;
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
    values[relationship.navigationProperty] = null;
    if (previous) {
        removeFromRelationshipInverse(
            tracker,
            relationship,
            previous,
            dependent.entity,
        );
    }
}
