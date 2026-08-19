import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    captureNavigationCheckpoint,
    restoreNavigationCheckpoint,
    type LoadedNavigationCheckpoint,
} from './navigation-load-checkpoint';
import {
    detachOwnedRegistrations,
    fingerprintOwnedRegistration,
    recordOwnedRegistration,
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
 * for everyone else. `own` fingerprints the entry as registration leaves it,
 * and rollback detaches only while that whole fingerprint still holds and no
 * queued work is anchored on the entity. Anything else -- a `remove()`, an
 * accepted edit, a scalar assignment no detection pass has looked at yet, a
 * navigation this load never wrote -- is user intent that detaching would
 * silently destroy, so the detach fails closed and poisons the context instead
 * of resolving the conflict in rollback's favour. State alone cannot carry that
 * judgement: an untouched entry and one whose edit was already accepted are
 * both Unchanged.
 *
 * The fingerprint is taken *after* the registration is recorded, never as part
 * of recording it. Capture reads the live entity, so it can throw and fail the
 * load; recorded first, that failure leaves rollback a registration with no
 * fingerprint, which can never prove exclusive ownership and is refused like
 * any other unreadable one. Recorded second, it would leave the load's own
 * tracking standing with nothing that knows to take it back.
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
            //
            // Recorded before it is fingerprinted, because fingerprinting reads
            // the live entity and an application accessor can refuse. Tracking
            // this load established is already standing by the time `own` is
            // called, so anything that fails after that point has to fail with
            // the registration already in rollback's hands.
            const registration = recordOwnedRegistration(entry);
            owned.set(entry.entity, registration);
            fingerprintOwnedRegistration(tracker, registration);
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
