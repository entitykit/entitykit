import type { Model } from '../model/model';
import { RelationshipCardinality } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import {
    navigationSnapshot,
    navigationValueChanged,
} from './navigation-snapshot';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { relationshipPropertyWasModified } from './relationship-detection-values';
import { findTrackedPrincipal } from './relationship-resolution';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export interface OneToOneIntent {
    readonly dependent: EntityEntry<object>;
    readonly previous?: EntityEntry<object>;
    readonly desired?: EntityEntry<object>;
    readonly changed: boolean;
}

export interface OneToOneIntentGroup {
    readonly relationship: TrackedRelationshipMetadata;
    readonly intents: readonly OneToOneIntent[];
}

export function captureOneToOneIntentGroups(
    tracker: ChangeTracker,
    model: Model,
    captured: RelationshipDetectionValues,
): readonly OneToOneIntentGroup[] {
    return model.entities.flatMap(dependentMetadata =>
        (dependentMetadata.relationships as
            readonly TrackedRelationshipMetadata[])
            .filter(relationship =>
                relationship.cardinality === RelationshipCardinality.OneToOne)
            .map(relationship => ({
                relationship,
                intents: tracker.entries()
                    .filter(entry =>
                        entry.metadata === dependentMetadata &&
                        entry.state !== EntityState.Detached)
                    .map(entry => captureOneToOneIntent(
                        tracker, model, entry, relationship, captured,
                    )),
            })),
    );
}

export function captureOneToOneIntent(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
): OneToOneIntent {
    const property = relationship.navigationProperty;
    const snapshot = navigationSnapshot(dependent, property);
    const current = (dependent.entity as Record<string, unknown>)[property];
    const navigationChanged = snapshot.known &&
        navigationValueChanged(snapshot.value, current);
    const inverse = inverseIntent(tracker, dependent, relationship);
    const foreignKeyChanged = relationship.foreignKeyProperties.some(
        foreignKey => relationshipPropertyWasModified(
            dependent, foreignKey, captured,
        ),
    );
    const previous = trackedEntry(tracker, snapshot.value) ?? inverse.previous;
    let desired: EntityEntry<object> | undefined;
    if (navigationChanged) {
        desired = trackedEntry(tracker, current);
    } else if (inverse.changed) {
        desired = inverse.desired;
    } else if (foreignKeyChanged) {
        desired = findTrackedPrincipal(
            tracker, model, dependent, relationship, captured,
        );
    } else {
        desired = trackedEntry(tracker, current) ?? previous;
    }
    return {
        dependent,
        previous,
        desired,
        changed: navigationChanged || inverse.changed || foreignKeyChanged,
    };
}

function inverseIntent(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): {
    readonly previous?: EntityEntry<object>;
    readonly desired?: EntityEntry<object>;
    readonly changed: boolean;
} {
    const inverse = relationship.inverseNavigationProperty;
    if (!inverse) return { changed: false };
    let previous: EntityEntry<object> | undefined;
    let desired: EntityEntry<object> | undefined;
    let changed = false;
    for (const principal of tracker.entries()) {
        if (principal.metadata.ctor !== relationship.principalEntity) continue;
        const snapshot = navigationSnapshot(principal, inverse);
        const current = (principal.entity as Record<string, unknown>)[inverse];
        if (snapshot.value === dependent.entity) previous = principal;
        if (current === dependent.entity) desired = principal;
        if (
            snapshot.known &&
            navigationValueChanged(snapshot.value, current) &&
            (snapshot.value === dependent.entity || current === dependent.entity)
        ) changed = true;
    }
    return { previous, desired, changed };
}

function trackedEntry(
    tracker: ChangeTracker,
    value: unknown,
): EntityEntry<object> | undefined {
    return value && typeof value === 'object'
        ? tracker.entry(value)
        : undefined;
}
