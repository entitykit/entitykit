import type { ChangeTracker } from './change-tracker';
import type { ChangeTrackerObservers } from './change-tracker-observers';
import { ChangeTrackerRegistry } from './change-tracker-registry';
import type { SaveMutationGuard } from './save-mutation-guard';

/** Bind registry callbacks to one tracker's guard and current observer slots. */
export function createChangeTrackerRegistry(
    tracker: ChangeTracker,
    saveGuard: SaveMutationGuard,
    observers: ChangeTrackerObservers,
): ChangeTrackerRegistry {
    return new ChangeTrackerRegistry(
        tracker,
        (operation, entity, identityKey) => {
            saveGuard.assertMutation(operation, entity, identityKey);
        },
        entity => observers.notifyTracked(entity),
        entity => observers.notifyDetached(entity),
    );
}
