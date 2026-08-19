import { runRestorationActions } from '../restoration-actions';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    captureOwnedEntryCheckpoint,
    type OwnedEntryCheckpoint,
} from './navigation-load-ownership-checkpoint';
import {
    ownedEntryMatchesCheckpoint,
} from './navigation-load-ownership-comparison';

/**
 * The ownership half of a navigation load's tracker rollback.
 *
 * A registration is recorded per *entry*, never per entity: the entry object
 * this load's own `track()` returned, beside a complete fingerprint of how that
 * entry stood at the moment registration succeeded. Both facts are read back at
 * restore time, and both have to still hold before the detach is allowed.
 *
 * The two arrive separately, and in that order. Recording an entry is bookkeeping
 * that cannot fail; fingerprinting it reads the live entity through application
 * accessors and can. So the registration exists first and unconditionally, and
 * `checkpoint` is filled in by a capture that succeeded -- a capture that threw
 * leaves a registration with no fingerprint at all rather than no registration.
 */
export interface OwnedRegistration {
    readonly entry: EntityEntry<object>;
    /** Assigned once, by a capture that returned; undefined if none did. */
    checkpoint?: OwnedEntryCheckpoint;
}

/** Record one registration this load made, before anything is read. */
export function recordOwnedRegistration(
    entry: EntityEntry<object>,
): OwnedRegistration {
    return { entry };
}

/**
 * Fingerprint a recorded registration, or leave it bare and fail the load.
 *
 * The capture is never caught here. Reading the entity is what a load does to
 * establish it in the first place, and an accessor that refuses partway through
 * has produced an entity nothing can reason about: the load must fail on it,
 * exactly as it fails on an accessor that refuses inside `track()`. What changes
 * is only what rollback inherits -- a registration it can refuse, instead of
 * tracking nobody recorded.
 */
export function fingerprintOwnedRegistration(
    tracker: ChangeTracker,
    registration: OwnedRegistration,
): void {
    registration.checkpoint = captureOwnedEntryCheckpoint(
        tracker, registration.entry,
    );
}

/**
 * Detach exactly the registrations this load made, or fail closed.
 *
 * Every registration is attempted, so one refusal never strands the rest, and
 * the refusals are aggregated into the load's cleanup failures.
 */
export function detachOwnedRegistrations(
    tracker: ChangeTracker,
    owned: readonly OwnedRegistration[],
): void {
    runRestorationActions(owned.map(registration => () => {
        // A different entry object standing under the same entity is proof
        // somebody else established this tracking, not an ambiguity: the
        // registration this load made is already gone, so there is nothing
        // here to take back and nothing to report.
        if (tracker.entry(registration.entry.entity) !== registration.entry) {
            return;
        }
        assertDetachableRegistration(tracker, registration);
        tracker.detach(registration.entry.entity);
    }));
}

/**
 * Refuse a detach that would take durable user intent with it.
 *
 * Detaching is silent by design: queued join work anchored on the entity is
 * cancelled with it, and a `remove()` or an edit -- detected, accepted, or
 * still waiting for the next detection pass -- simply stops existing. That is
 * the right answer when a caller asks for it, and the wrong one while a failed
 * load unwinds: the caller's `link()`, `unlink()`, or `remove()` reported
 * success, and their assignment to a mapped property is durable work whether or
 * not any change detection has run over it yet. Neither the graph nor the save
 * plan can be reconciled afterwards, so the conflict poisons the context
 * instead of being resolved in rollback's favour.
 */
function assertDetachableRegistration(
    tracker: ChangeTracker,
    registration: OwnedRegistration,
): void {
    if (detachableRegistration(tracker, registration)) return;
    throw new Error(
        `Entity '${registration.entry.metadata.entityName}' changed while ` +
        'its load was in progress; rollback cannot safely detach it.',
    );
}

/**
 * Whether this entry is still the load's alone, by fingerprint and by queue.
 *
 * A fingerprint that cannot be read is not a fingerprint that matches. An
 * accessor or converter that throws while the comparison reads it leaves the
 * entry's state unknowable, and an unknowable entry is never detached.
 *
 * A registration that never got a fingerprint is that same answer, reached one
 * step earlier: capture read the live entity and threw, so there is nothing to
 * compare and nothing that could prove this entry is still only the load's.
 *
 * An unconditional detach would in fact be sound *today*. The capture throws
 * inside the load's own promise, and rollback runs in the `catch` that unwinds
 * it, before the rejection is ever delivered to the application -- so no public
 * code can interleave, and the entry provably cannot have moved since the throw.
 * That argument is worth stating and worth not depending on: it rests entirely
 * on the shape of one async unwind, and any later path that captures outside a
 * load's own failure would invalidate it silently, restoring precisely the
 * silent detach the rest of this module exists to prevent. Failing closed rests
 * on nothing, matches the answer given to every other unreadable fingerprint,
 * and reports the ambiguity instead of resolving it in rollback's favour.
 */
function detachableRegistration(
    tracker: ChangeTracker,
    registration: OwnedRegistration,
): boolean {
    const { checkpoint } = registration;
    if (checkpoint === undefined) return false;
    try {
        return !tracker.hasQueuedWork(registration.entry.entity) &&
            ownedEntryMatchesCheckpoint(
                tracker, registration.entry, checkpoint,
            );
    } catch {
        return false;
    }
}
