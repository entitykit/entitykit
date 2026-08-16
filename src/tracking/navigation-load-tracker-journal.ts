import { runRestorationActions } from '../restoration-actions';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    captureNavigationCheckpoint,
    restoreNavigationCheckpoint,
    type LoadedNavigationCheckpoint,
} from './navigation-load-checkpoint';

/**
 * The two tracker facts one navigation load has to be able to take back.
 *
 * *Ownership* is "this load was the first to track this entity": `own` records
 * it at the moment registration succeeds, and rollback detaches exactly those
 * entities, so tracking that arrived from anywhere else while the load was in
 * flight -- an `add()`, an `attach()`, a queued `link()` -- survives a failed
 * load. *Participation* is "this load is about to change tracker-owned facts
 * for this navigation": `touch` captures one property's loaded flag, navigation
 * baseline, and change-detection suppression once, before the first such
 * change, and rollback restores them in place without detaching anything.
 *
 * Participation is per (entry, navigation) pair, never per entry. An entry can
 * carry a navigation this load is stitching beside one it never looked at, and
 * a failed nested query may not reach back into the second: whether an accepted
 * relationship runs a second time must not depend on an unrelated query failing.
 *
 * The two facts are independent. An entity attached after the load began and
 * then resolved out of the identity map is a participant the load does not own:
 * its facts must be restored while its tracking is left alone, or a failed read
 * leaves an entry describing a graph that was rolled back underneath it.
 * Neither fact is ever inferred from tracker membership before and after --
 * temporal ordering is not ownership, and it is not participation either.
 */
export interface NavigationLoadTrackerJournal {
    /** Capture one navigation's tracker facts before this load changes them. */
    touch(entry: EntityEntry<object>, navigationProperty: string): void;
    /** Record an entity this load was the first to track. */
    own(entity: object): void;
    restorationActions(): Array<() => void>;
}

type TouchedNavigations = Map<
    EntityEntry<object>, Map<string, LoadedNavigationCheckpoint>
>;

/** Capture navigations lazily, immediately before this load mutates them. */
export function createNavigationLoadTrackerJournal(
    tracker: ChangeTracker,
): NavigationLoadTrackerJournal {
    const touched: TouchedNavigations = new Map();
    const owned: Set<object> = new Set();
    const journal: NavigationLoadTrackerJournal = {
        touch: (entry: EntityEntry<object>, navigationProperty: string): void => {
            const properties = touched.get(entry)
                ?? new Map<string, LoadedNavigationCheckpoint>();
            touched.set(entry, properties);
            // Only the first touch of this pair is the truth this load has to
            // hand back; later ones would capture changes it already made.
            if (properties.has(navigationProperty)) return;
            properties.set(
                navigationProperty,
                captureNavigationCheckpoint(entry, navigationProperty),
            );
        },
        own: (entity: object): void => {
            owned.add(entity);
        },
        // Restore participation first: an owned entry may also have been
        // touched, and detaching it afterwards is what wins for that entity.
        restorationActions: (): Array<() => void> => [
            ...touchedCheckpoints(touched).map(checkpoint => (): void => {
                restoreNavigationCheckpoint(checkpoint);
            }),
            (): void => {
                detachOwnedEntities(tracker, owned);
            },
        ],
    };
    return journal;
}

/** Flatten the per-entry property maps into one capture-ordered list. */
function touchedCheckpoints(
    touched: TouchedNavigations,
): LoadedNavigationCheckpoint[] {
    return [...touched.values()].flatMap(
        properties => [...properties.values()],
    );
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
