import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import {
    navigationSnapshot,
    navigationValueChanged,
} from './navigation-snapshot';
import { navigationChangeDetectionAllowed } from './navigation-change-detection-state';
import { navigationItems } from './relationship-inverse-navigation-items';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export interface InverseIntent {
    readonly dependent: EntityEntry<object>;
    readonly relationship: TrackedRelationshipMetadata;
    readonly addedTo: Set<EntityEntry<object>>;
    readonly removedFrom: Set<EntityEntry<object>>;
}

export interface ChangedInverse {
    readonly principal: EntityEntry<object>;
    readonly property: string;
    handled: boolean;
}

export type InverseIntents = Map<EntityEntry<object>, Map<
    TrackedRelationshipMetadata, InverseIntent
>>;

/** Collect inverse graph edits without mutating tracked relationships. */
export function collectInverseIntents(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
    intents: InverseIntents,
    changes: ChangedInverse[],
): void {
    for (const principal of entries) {
        if (principal.state === EntityState.Detached) continue;
        for (const dependentMetadata of model.entities) {
            for (const relationship of dependentMetadata.relationships as
                readonly TrackedRelationshipMetadata[]) {
                if (
                    relationship.principalEntity !== principal.metadata.ctor ||
                    !relationship.inverseNavigationProperty
                ) continue;
                collectNavigationChange(
                    tracker, principal, relationship, intents, changes,
                );
            }
        }
    }
}

function collectNavigationChange(
    tracker: ChangeTracker,
    principal: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    intents: InverseIntents,
    changes: ChangedInverse[],
): void {
    const property = relationship.inverseNavigationProperty;
    if (!property || !navigationChangeDetectionAllowed(principal, property)) {
        return;
    }
    const snapshot = navigationSnapshot(principal, property);
    const current = (principal.entity as Record<string, unknown>)[property];
    if (!snapshot.known || !navigationValueChanged(snapshot.value, current)) {
        return;
    }
    const change: ChangedInverse = { principal, property, handled: true };
    changes.push(change);
    const previous = navigationItems(snapshot.value, relationship);
    const present = navigationItems(current, relationship);
    for (const entity of present.filter(item => !previous.includes(item))) {
        change.handled = addIntent(
            tracker, entity, relationship, principal, 'addedTo', intents,
        ) && change.handled;
    }
    for (const entity of previous.filter(item => !present.includes(item))) {
        change.handled = addIntent(
            tracker, entity, relationship, principal, 'removedFrom', intents,
        ) && change.handled;
    }
}

function addIntent(
    tracker: ChangeTracker,
    entity: object,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
    side: 'addedTo' | 'removedFrom',
    intents: InverseIntents,
): boolean {
    const dependent = tracker.entry(entity);
    const relationships = dependent?.metadata.relationships as
        readonly object[] | undefined;
    if (!dependent || !relationships?.includes(relationship)) {
        return false;
    }
    const byRelationship = intents.get(dependent) ?? new Map<
        TrackedRelationshipMetadata, InverseIntent
    >();
    const intent: InverseIntent = byRelationship.get(relationship) ?? {
        dependent, relationship,
        addedTo: new Set<EntityEntry<object>>(),
        removedFrom: new Set<EntityEntry<object>>(),
    };
    if (side === 'addedTo') intent.addedTo.add(principal);
    else intent.removedFrom.add(principal);
    byRelationship.set(relationship, intent);
    intents.set(dependent, byRelationship);
    return true;
}
