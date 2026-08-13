import type { Model } from '../model/model';
import { RelationshipCardinality } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { navigationSnapshot, navigationValueChanged } from './navigation-snapshot';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { relationshipPropertyWasModified } from './relationship-detection-values';
import { findTrackedPrincipal } from './relationship-resolution';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import {
    dependentTargetIdentity,
    originalDependentTargetIdentity,
    principalTargetIdentity,
} from './one-to-one-target-identity';
import {
    captureOneToOneInverseIntents,
    type OneToOneInverseIntent,
    trackedNavigationEntry,
} from './one-to-one-inverse-intent';

export interface OneToOneIntent {
    readonly dependent: EntityEntry<object>;
    readonly previous?: EntityEntry<object>;
    readonly desired?: EntityEntry<object>;
    readonly previousTarget?: string;
    readonly desiredTarget?: string;
    readonly changed: boolean;
    readonly explicit: boolean;
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
    const entries = tracker.entries();
    return model.entities.flatMap(dependentMetadata =>
        (dependentMetadata.relationships as
            readonly TrackedRelationshipMetadata[])
            .filter(relationship =>
                relationship.cardinality === RelationshipCardinality.OneToOne)
            .map(relationship => {
                const inverse = captureOneToOneInverseIntents(
                    tracker, entries, relationship,
                );
                return {
                    relationship,
                    intents: entries
                        .filter(entry =>
                            entry.metadata === dependentMetadata &&
                            entry.state !== EntityState.Detached)
                        .map(entry => captureOneToOneIntent(
                            tracker, model, entry, relationship, captured,
                            inverse.get(entry),
                        )),
                };
            }),
    );
}
export function captureOneToOneIntent(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured: RelationshipDetectionValues,
    inverse: OneToOneInverseIntent = { changed: false },
): OneToOneIntent {
    const property = relationship.navigationProperty;
    const snapshot = navigationSnapshot(dependent, property);
    const current = (dependent.entity as Record<string, unknown>)[property];
    const navigationChanged = snapshot.known &&
        navigationValueChanged(snapshot.value, current);
    const foreignKeyChanged = relationship.foreignKeyProperties.some(
        foreignKey => relationshipPropertyWasModified(
            dependent, foreignKey, captured,
        ),
    );
    const previous = dependent.state === EntityState.Added
        ? undefined
        : trackedNavigationEntry(tracker, snapshot.value) ?? inverse.previous;
    const previousTarget = dependent.state === EntityState.Added
        ? undefined
        : originalDependentTargetIdentity(
            tracker, model, dependent, relationship,
        );
    let desired: EntityEntry<object> | undefined;
    let desiredTarget: string | undefined;
    if (dependent.state === EntityState.Deleted) {
        if (dependent.metadata.softDelete) {
            desired = previous;
            desiredTarget = previousTarget;
        }
    } else if (navigationChanged) {
        desired = trackedNavigationEntry(tracker, current);
        desiredTarget = targetForNavigation(
            tracker, model, dependent, relationship, current, captured,
        );
    } else if (inverse.changed) {
        desired = inverse.desired;
        desiredTarget = desired
            ? principalTargetIdentity(
                tracker, model, dependent.metadata, relationship,
                desired.entity, captured,
            )
            : undefined;
    } else if (foreignKeyChanged) {
        desired = findTrackedPrincipal(
            tracker, model, dependent, relationship, captured,
        );
        desiredTarget = dependentTargetIdentity(
            tracker, model, dependent, relationship, captured,
        );
    } else {
        desired = trackedNavigationEntry(tracker, current) ?? previous;
        desiredTarget = targetForNavigation(
            tracker, model, dependent, relationship, current, captured,
        ) ?? dependentTargetIdentity(
            tracker, model, dependent, relationship, captured,
        );
    }
    const changed = navigationChanged || inverse.changed || foreignKeyChanged;
    return {
        dependent,
        previous,
        desired,
        previousTarget,
        desiredTarget,
        changed,
        explicit: dependent.state === EntityState.Added || changed,
    };
}
function targetForNavigation(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    value: unknown,
    captured: RelationshipDetectionValues,
): string | undefined {
    return value && typeof value === 'object'
        ? principalTargetIdentity(
            tracker, model, dependent.metadata, relationship, value, captured,
        )
        : undefined;
}
