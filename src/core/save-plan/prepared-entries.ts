import type { RestorationScope } from '../../restoration-scope';
import type { ChangeTracker } from '../../tracking/change-tracker';
import { changeTrackerModel } from '../../tracking/change-tracker-model';
import { EntityState } from '../../tracking/entity-state';
import {
    capturePersistedEntrySnapshot,
    refreshPersistedEntryRelationships,
    type PersistedEntrySnapshot,
} from '../../tracking/persisted-entry-snapshot';
import { refreshRelationshipPlanSnapshot } from '../relationship-plan-snapshot';
import type { SaveTimeWrites } from '../save-time-writes';
import { orderSaveEntries } from './order-entries';

export interface PreparedSaveEntries {
    readonly snapshots: readonly PersistedEntrySnapshot[];
    readonly pending: readonly PersistedEntrySnapshot[];
}

/** Capture, reconcile, and order the tracked state used by one plan. */
export function prepareSaveEntries(
    tracker: ChangeTracker,
    writes: SaveTimeWrites,
    restoration: RestorationScope,
): PreparedSaveEntries {
    let snapshots = tracker.entries().map(capturePersistedEntrySnapshot);
    const values = new Map(snapshots.map(snapshot => [
        snapshot.entry, snapshot.values,
    ]));
    const generation = writes.beginRelationshipGeneration(snapshots);
    tracker.detectSaveRelationships(
        undefined, values, true, restoration, generation.complete.bind(generation),
    );
    const relationshipChanges = generation.changedForeignKeyEntries();
    const retainedEntries = new Set(tracker.entries());
    snapshots = snapshots
        .filter(snapshot => retainedEntries.has(snapshot.entry))
        .map(snapshot => refreshRelationshipPlanSnapshot(
            snapshot, relationshipChanges.has(snapshot.entry),
        ));
    snapshots = writes.applyTo(snapshots, restoration);
    const reconciled = writes.reconcileRelationships(tracker, restoration);
    snapshots = snapshots.map(snapshot => {
        const changes = reconciled.get(snapshot.entry.entity);
        return changes
            ? refreshPersistedEntryRelationships(
                snapshot, changes.foreignKeys,
            )
            : snapshot;
    });
    writes.rememberRelationshipAcceptance(snapshots.filter(snapshot =>
        (reconciled.get(snapshot.entry.entity)?.navigations.size ?? 0) > 0));
    const model = changeTrackerModel(tracker);
    if (!model) throw new Error('Save planning requires a configured model.');
    const pending = orderSaveEntries(snapshots.filter(snapshot =>
        snapshot.state === EntityState.Added ||
        snapshot.state === EntityState.Modified ||
        snapshot.state === EntityState.Deleted,
    ), tracker, model, snapshots);
    return { snapshots, pending };
}
