import { runRestorationActions } from '../restoration-actions';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';

/**
 * The ownership half of a navigation load's tracker rollback.
 *
 * A registration is recorded per *entry*, never per entity: the entry object
 * this load's own `track()` returned, beside the state it was registered in.
 * Both facts are read back at restore time, and both have to still hold before
 * the detach is allowed to happen.
 */
export interface OwnedRegistration {
    readonly entry: EntityEntry<object>;
    readonly state: EntityState;
}

/** Record one registration this load made, as it stood when it succeeded. */
export function captureOwnedRegistration(
    entry: EntityEntry<object>,
): OwnedRegistration {
    return { entry, state: entry.state };
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
 * cancelled with it, and a `remove()` or a detected modification simply stops
 * existing. That is the right answer when a caller asks for it, and the wrong
 * one while a failed load unwinds -- the caller's `link()`, `unlink()`, or
 * `remove()` reported success, so rollback may not quietly decide against it.
 * Neither the graph nor the save plan can be reconciled afterwards, so the
 * conflict poisons the context instead of being resolved in rollback's favour.
 */
function assertDetachableRegistration(
    tracker: ChangeTracker,
    registration: OwnedRegistration,
): void {
    const { entry, state } = registration;
    if (entry.state === state && !tracker.hasQueuedWork(entry.entity)) return;
    throw new Error(
        `Entity '${entry.metadata.entityName}' changed while its load was ` +
        'in progress; rollback cannot safely detach it.',
    );
}
