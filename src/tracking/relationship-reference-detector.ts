import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import {
    navigationSnapshot,
    navigationValueChanged,
} from './navigation-snapshot';
import {
    clearStaleReference,
    linkDependent,
    severDependent,
} from './relationship-fixup';
import { findTrackedPrincipal } from './relationship-resolution';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export function detectReferenceChanges(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
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
            detectReferenceChange(tracker, model, dependent, relationship);
        }
    }
}

function detectReferenceChange(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): void {
    const values = dependent.entity as Record<string, unknown>;
    const current = values[relationship.navigationProperty];
    const snapshot = navigationSnapshot(
        dependent,
        relationship.navigationProperty,
    );
    const navigationChanged = snapshot.known &&
        navigationValueChanged(snapshot.value, current);
    const foreignKeyChanged = relationship.foreignKeyProperties.some(
        property => dependent.modifiedProperties().includes(property),
    );

    if (navigationChanged || dependent.state === EntityState.Added && current) {
        if (current && typeof current === 'object') {
            linkDependent(
                tracker,
                model,
                dependent,
                relationship,
                current,
                snapshot.value,
            );
        } else if (snapshot.value) {
            severDependent(
                tracker,
                dependent,
                relationship,
                snapshot.value,
            );
        }
        return;
    }

    if (!foreignKeyChanged) {
        return;
    }
    const principal = findTrackedPrincipal(
        tracker,
        model,
        dependent,
        relationship,
    );
    if (principal) {
        linkDependent(
            tracker,
            model,
            dependent,
            relationship,
            principal.entity,
        );
    } else if (relationship.foreignKeyProperties.some(
        property => values[property] === null || values[property] === undefined,
    )) {
        severDependent(tracker, dependent, relationship);
    } else {
        clearStaleReference(tracker, dependent, relationship);
    }
}
