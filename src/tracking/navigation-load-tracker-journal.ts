import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    captureNavigationCheckpoint,
    restoreNavigationCheckpoint,
    type LoadedNavigationCheckpoint,
} from './navigation-load-checkpoint';
import {
    captureOwnedRegistration,
    detachOwnedRegistrations,
    type OwnedRegistration,
} from './navigation-load-ownership';

/**
 * The two tracker facts one navigation load has to be able to take back.
 *
 * *Ownership* is "this load established this entry": `own` records the entry
 * at the moment registration succeeds, and rollback detaches exactly those
 * registrations, so tracking that arrived from anywhere else while the load was
 * in flight -- an `add()`, an `attach()`, a queued `link()` -- survives a failed
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
 *
 * Ownership is recorded, and unwound, per *entry* rather than per entity. A
 * caller who detaches the load's entry and establishes their own -- `detach()`
 * then `attach()`, on the same instance -- leaves a different entry object
 * standing under the same entity, and that entry is theirs: rollback skips it
 * silently, because a distinct entry is proof rather than ambiguity.
 *
 * The entry rollback still owns is detached only while the detach is a no-op
 * for everyone else. An entry whose state moved off what the load established,
 * or one still named by queued work the tracker anchors on it, carries user
 * intent that detaching would silently destroy -- a queued join row cancelled
 * with its target, a `remove()` erased -- so the detach fails closed and
 * poisons the context instead of resolving the conflict in rollback's favour.
 */
export interface NavigationLoadTrackerJournal {
    /** Capture one navigation's tracker facts before this load changes them. */
    touch(entry: EntityEntry<object>, navigationProperty: string): void;
    /** Record an entry whose registration this load was the one to make. */
    own(entry: EntityEntry<object>): void;
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
    const owned: Map<object, OwnedRegistration> = new Map();
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
        own: (entry: EntityEntry<object>): void => {
            // Keyed by entity: one entity can only carry one entry at a time,
            // and a re-registration is the newer of the load's own two.
            owned.set(entry.entity, captureOwnedRegistration(entry));
        },
        // Restore participation first: an owned entry may also have been
        // touched, and detaching it afterwards is what wins for that entity.
        restorationActions: (): Array<() => void> => [
            ...touchedCheckpoints(touched).map(checkpoint => (): void => {
                restoreNavigationCheckpoint(checkpoint);
            }),
            (): void => {
                detachOwnedRegistrations(tracker, [...owned.values()]);
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

/** The journal for navigation writers running outside a load operation. */
export const inertNavigationLoadTrackerJournal: NavigationLoadTrackerJournal = {
    touch: (): void => undefined,
    own: (): void => undefined,
    restorationActions: (): Array<() => void> => [],
};
