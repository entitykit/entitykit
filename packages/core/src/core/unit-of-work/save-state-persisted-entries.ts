import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import type { SavePlanEntry } from '../save-plan';
import { savePlanExecution } from '../save-plan-execution';
import type { SaveTimeWrites } from '../save-time-writes';

/** Merge DML and navigation-only acceptance by tracked entry. */
export function saveStatePersistedEntries(
    plan: readonly SavePlanEntry[],
    writes: SaveTimeWrites,
): readonly PersistedEntrySnapshot[] {
    const entries = [
        ...plan.flatMap(item =>
            savePlanExecution(item)?.persistedEntries ?? []),
        ...writes.relationshipAcceptanceSnapshots(),
    ];
    return [...new Map(entries.map(snapshot => [
        snapshot.entry,
        snapshot,
    ])).values()];
}
