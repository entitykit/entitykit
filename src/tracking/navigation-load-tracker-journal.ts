import { runRestorationActions } from '../restoration-actions';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    captureEntryCheckpoint,
    restoreEntryCheckpoint,
    type LoadedEntryCheckpoint,
} from './navigation-load-checkpoint';

/**
 * The two tracker facts one navigation load has to be able to take back.
 *
 * *Ownership* is "this load was the first to track this entity": `own` records
 * it at the moment registration succeeds, and rollback detaches exactly those
 * entities, so tracking that arrived from anywhere else while the load was in
 * flight -- an `add()`, an `attach()`, a queued `link()` -- survives a failed
 * load. *Participation* is "this load is about to change tracker-owned facts
 * for this entry": `touch` captures the entry's loaded flags, navigation
 * baselines, and change-detection suppression once, before the first such
 * change, and rollback restores them in place without detaching anything.
 *
 * The two are independent. An entity attached after the load began and then
 * resolved out of the identity map is a participant the load does not own: its
 * facts must be restored while its tracking is left alone, or a failed read
 * leaves an entry describing a graph that was rolled back underneath it.
 * Neither fact is ever inferred from tracker membership before and after --
 * temporal ordering is not ownership, and it is not participation either.
 */
export interface NavigationLoadTrackerJournal {
    /** Capture an entry's tracker facts before this load changes them. */
    touch(entry: EntityEntry<object>): void;
    /** Record an entity this load was the first to track. */
    own(entity: object): void;
    restorationActions(): Array<() => void>;
}

/** Pre-touch every entry present now; later arrivals touch on first use. */
export function createNavigationLoadTrackerJournal(
    tracker: ChangeTracker,
): NavigationLoadTrackerJournal {
    const touched: Map<EntityEntry<object>, LoadedEntryCheckpoint> = new Map();
    const owned: Set<object> = new Set();
    const journal: NavigationLoadTrackerJournal = {
        touch: (entry: EntityEntry<object>): void => {
            // Only the first touch is the pre-load truth; later ones would
            // capture changes this same load already made.
            if (touched.has(entry)) return;
            touched.set(entry, captureEntryCheckpoint(entry));
        },
        own: (entity: object): void => {
            owned.add(entity);
        },
        // Restore participation first: an owned entry may also have been
        // touched, and detaching it afterwards is what wins for that entity.
        restorationActions: (): Array<() => void> => [
            ...[...touched.values()].map(checkpoint => (): void => {
                restoreEntryCheckpoint(checkpoint);
            }),
            (): void => {
                detachOwnedEntities(tracker, owned);
            },
        ],
    };
    for (const entry of tracker.entries()) journal.touch(entry);
    return journal;
}

/** Detach exactly the entities this load recorded as freshly tracked. */
function detachOwnedEntities(
    tracker: ChangeTracker,
    owned: ReadonlySet<object>,
): void {
    runRestorationActions([...owned].map(entity => () => {
        tracker.detach(entity);
    }));
}

/** The journal for navigation writers running outside a load operation. */
export const inertNavigationLoadTrackerJournal: NavigationLoadTrackerJournal = {
    touch: (): void => undefined,
    own: (): void => undefined,
    restorationActions: (): Array<() => void> => [],
};
