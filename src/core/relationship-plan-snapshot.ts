import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { refreshPersistedEntryRelationships } from '../tracking/persisted-entry-snapshot';

/** Align one executable snapshot with ordinary relationship fix-up. */
export function refreshRelationshipPlanSnapshot(
    snapshot: PersistedEntrySnapshot,
    foreignKeyChanged: boolean,
): PersistedEntrySnapshot {
    if (foreignKeyChanged) {
        snapshot.entry.setStateFromCapturedValues(snapshot.values);
    }
    return refreshPersistedEntryRelationships(snapshot, new Set());
}
