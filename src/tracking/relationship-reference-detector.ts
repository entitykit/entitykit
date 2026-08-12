import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import {
    captureNavigation,
    navigationSnapshot,
    navigationValueChanged,
} from './navigation-snapshot';
import {
    clearStaleReference,
    linkDependent,
    severDependent,
} from './relationship-fixup';
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

export function detectReferenceChanges(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
    captured: RelationshipDetectionValues,
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
                tracker, model, dependent, relationship, captured,
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
        let handled = false;
        if (current && typeof current === 'object') {
            linkDependent(
                tracker,
                model,
                dependent,
                relationship,
                current,
                snapshot.value,
                captured,
            );
            handled = true;
        } else if (snapshot.value) {
            severDependent(
                tracker,
                dependent,
                relationship,
                snapshot.value,
                captured,
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
                dependent, relationship, currentEntry, captured,
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
    const principal = findTrackedPrincipal(
        tracker,
        model,
        dependent,
        relationship,
        captured,
    );
    if (principal) {
        linkDependent(
            tracker,
            model,
            dependent,
            relationship,
            principal.entity,
            undefined,
            captured,
        );
    } else if (relationship.foreignKeyProperties.some(
        property => values[property] === null || values[property] === undefined,
    )) {
        severDependent(tracker, dependent, relationship, undefined, captured);
    } else {
        clearStaleReference(tracker, dependent, relationship);
    }
}
