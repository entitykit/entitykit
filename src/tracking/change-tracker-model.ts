import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { configureEntityEntryStore } from './entity-entry-concurrency';
import type { EntityEntryStore } from './entity-entry-store';
import { configureEntityEntryMutationGuard } from './entity-entry-mutation-guard';

const models: WeakMap<ChangeTracker, Model> = new WeakMap();
const stores: WeakMap<ChangeTracker, EntityEntryStore> = new WeakMap();

/** Associate a context-owned tracker with its finalized model. */
export function configureChangeTrackerModel(
    tracker: ChangeTracker,
    model: Model,
): void {
    models.set(tracker, model);
}

export function changeTrackerModel(tracker: ChangeTracker): Model | undefined {
    return models.get(tracker);
}

export function configureChangeTrackerStore(
    tracker: ChangeTracker,
    store: EntityEntryStore,
): void {
    stores.set(tracker, store);
}

export function changeTrackerStore(
    tracker: ChangeTracker,
): EntityEntryStore | undefined {
    return stores.get(tracker);
}

export function configureTrackedEntry(
    tracker: ChangeTracker,
    entry: EntityEntry<object>,
    assertStateMutation?: () => void,
): void {
    const store = changeTrackerStore(tracker);
    if (store) {
        configureEntityEntryStore(entry, store);
    }
    if (assertStateMutation) {
        configureEntityEntryMutationGuard(entry, assertStateMutation);
    }
}
