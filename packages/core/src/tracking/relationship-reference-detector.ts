import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { captureNavigation, navigationSnapshot,
    navigationValueChanged } from './navigation-snapshot';
import { linkDependent,
    severDependent } from './relationship-fixup';
import { clearStaleReference } from './relationship-stale-reference';
import type { LoadedInverseCollectionBatch } from './loaded-inverse-collection-batch';
import {
    findTrackedPrincipal,
    relationshipForeignKeyMatchesPrincipal,
} from './relationship-resolution';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import {
    relationshipPropertyWasModified,
    relationshipValuesFor,
} from './relationship-detection-values';
import { relationshipForeignKeyMatchesUntrackedPrincipal } from './relationship-untracked-principal-match';
import { deleteGeneratedRelationshipTarget } from './generated-relationship-target-provenance';
export function detectReferenceChanges(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
    captured: RelationshipDetectionValues,
    inverseCollections?: LoadedInverseCollectionBatch,
): void {
    for (const dependent of entries) {
        if (
            dependent.state === EntityState.Deleted ||
            dependent.state === EntityState.Detached
        ) {
            continue;
        }
        const relationships = dependent.metadata.relationships as
            readonly TrackedRelationshipMetadata[];
        for (const relationship of relationships) {
            detectReferenceChange(
                tracker, model, dependent, relationship, captured, inverseCollections,
            );
        }
    }
}

function detectReferenceChange(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
    inverseCollections?: LoadedInverseCollectionBatch,
): void {
    const values = relationshipValuesFor(dependent, captured);
    const current = (dependent.entity as Record<string, unknown>)[
        relationship.navigationProperty
    ];
    const snapshot = navigationSnapshot(
        dependent,
        relationship.navigationProperty,
    );
    const navigationChanged = snapshot.known &&
        navigationValueChanged(snapshot.value, current);
    const foreignKeyChanged = relationship.foreignKeyProperties.some(
        property => relationshipPropertyWasModified(
            dependent, property, captured,
        ),
    );

    if (navigationChanged || dependent.state === EntityState.Added && current) {
        if (navigationChanged) {
            deleteGeneratedRelationshipTarget(dependent, relationship);
        }
        let handled = false;
        if (current && typeof current === 'object') {
            linkDependent(
                tracker, model, dependent, relationship, current,
                snapshot.value, captured, undefined, inverseCollections,
            );
            handled = true;
        } else if (snapshot.value) {
            severDependent(
                tracker, dependent, relationship, snapshot.value,
                captured, inverseCollections,
            );
            handled = true;
        }
        if (handled) {
            captureNavigation(dependent, relationship.navigationProperty);
        }
        return;
    }

    const currentObject = current && typeof current === 'object'
        ? current
        : undefined;
    const currentEntry = currentObject ? tracker.entry(currentObject) : undefined;
    const currentMatches = currentObject
        ? currentEntry
            ? relationshipForeignKeyMatchesPrincipal(
                tracker, dependent, relationship, currentEntry, captured,
            )
            : relationshipForeignKeyMatchesUntrackedPrincipal(
                model,
                dependent,
                relationship,
                currentObject as Record<string, unknown>,
                captured,
            )
        : relationship.foreignKeyProperties.every(property =>
            values[property] === null || values[property] === undefined);
    if (!foreignKeyChanged && currentMatches) {
        return;
    }
    if (
        !current &&
        !foreignKeyChanged &&
        dependent.isNavigationLoaded(relationship.navigationProperty)
    ) return;
    const principal = findTrackedPrincipal(
        tracker,
        model,
        dependent,
        relationship,
        captured,
    );
    if (principal) {
        linkDependent(
            tracker, model, dependent, relationship, principal.entity,
            undefined, captured, undefined, inverseCollections,
        );
    } else if (relationship.foreignKeyProperties.some(
        property => values[property] === null || values[property] === undefined,
    )) {
        severDependent(tracker, dependent, relationship, undefined, captured, inverseCollections);
    } else {
        clearStaleReference(tracker, dependent, relationship, inverseCollections);
    }
}
