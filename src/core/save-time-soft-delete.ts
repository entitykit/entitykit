import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';

export function applySoftDeleteWrite(
    snapshot: PersistedEntrySnapshot,
    now: () => Date,
    mutations: SaveTimeMutationLog,
): PersistedEntrySnapshot {
    const { entry } = snapshot;
    const softDelete = entry.metadata.softDelete;
    if (!softDelete || snapshot.state !== EntityState.Deleted) {
        return snapshot;
    }

    const value =
        softDelete.deletedValue !== undefined ? softDelete.deletedValue : now();
    const liveValues = entry.entity as Record<string, unknown>;
    mutations.recordCaptured(
        liveValues,
        softDelete.propertyName,
        snapshot.values[softDelete.propertyName],
    );
    snapshot.values[softDelete.propertyName] = value;
    liveValues[softDelete.propertyName] = value;
    mutations.recordState(entry);
    entry.state = EntityState.Modified;
    return { ...snapshot, state: EntityState.Modified };
}
