import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';
import { assertNoKeyModifications } from './save-plan/immutable-key-change';
import {
    ForeignEntityEntryError,
    NavigationLoadUnavailableError,
} from '../errors/navigation-errors';

/** Require a navigation target to be the context's current persisted entry. */
export function assertNavigationLoadableEntry<TEntity extends object>(
    tracker: ChangeTracker,
    entry: EntityEntry<TEntity>,
): void {
    if (tracker.entry(entry.entity) !== entry) {
        throw new ForeignEntityEntryError();
    }
    if (entry.state === EntityState.Added) {
        throw new NavigationLoadUnavailableError(
            'added',
            entry.metadata.entityName,
        );
    }
    assertNoKeyModifications(
        entry as unknown as EntityEntry<object>,
        entry.modifiedProperties(),
    );
}
