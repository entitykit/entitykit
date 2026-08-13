import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    navigationSnapshot,
    navigationValueChanged,
} from './navigation-snapshot';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export interface OneToOneInverseIntent {
    readonly previous?: EntityEntry<object>;
    readonly desired?: EntityEntry<object>;
    readonly changed: boolean;
}

export function captureOneToOneInverseIntents(
    tracker: ChangeTracker,
    entries: ReadonlyArray<EntityEntry<object>>,
    relationship: TrackedRelationshipMetadata,
): ReadonlyMap<EntityEntry<object>, OneToOneInverseIntent> {
    const inverse = relationship.inverseNavigationProperty;
    const intents: Map<EntityEntry<object>, OneToOneInverseIntent> = new Map();
    if (!inverse) return intents;
    for (const principal of entries) {
        if (principal.metadata.ctor !== relationship.principalEntity) continue;
        const snapshot = navigationSnapshot(principal, inverse);
        const current = (principal.entity as Record<string, unknown>)[inverse];
        const previous = trackedNavigationEntry(tracker, snapshot.value);
        const desired = trackedNavigationEntry(tracker, current);
        const changed =
            snapshot.known &&
            navigationValueChanged(snapshot.value, current);
        if (previous) merge(intents, previous, { previous: principal, changed });
        if (desired) merge(intents, desired, { desired: principal, changed });
    }
    return intents;
}

export function trackedNavigationEntry(
    tracker: ChangeTracker,
    value: unknown,
): EntityEntry<object> | undefined {
    return value && typeof value === 'object'
        ? tracker.entry(value)
        : undefined;
}

function merge(
    intents: Map<EntityEntry<object>, OneToOneInverseIntent>,
    dependent: EntityEntry<object>,
    update: OneToOneInverseIntent,
): void {
    const current = intents.get(dependent);
    intents.set(dependent, {
        previous: update.previous ?? current?.previous,
        desired: update.desired ?? current?.desired,
        changed: update.changed || current?.changed === true,
    });
}
