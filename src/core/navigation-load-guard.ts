import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';

/** Require a navigation target to be the context's current persisted entry. */
export function assertNavigationLoadableEntry<TEntity extends object>(
    tracker: ChangeTracker,
    entry: EntityEntry<TEntity>,
): void {
    if (tracker.entry(entry.entity) !== entry) {
        throw new Error(
            'EntityEntry belongs to another DbContext or is no longer tracked.',
        );
    }
    if (entry.state === EntityState.Added) {
        throw new Error(
            'Navigation loading is unavailable for an Added entity because it has no persisted identity.',
        );
    }
}
