import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';

export function applySoftDeleteWrite(
    entry: EntityEntry<object>,
    now: () => Date,
    mutations: SaveTimeMutationLog,
): void {
    const softDelete = entry.metadata.softDelete;
    if (!softDelete || entry.state !== EntityState.Deleted) {
        return;
    }

    const value =
        softDelete.deletedValue !== undefined ? softDelete.deletedValue : now();
    const values = entry.entity as Record<string, unknown>;
    mutations.record(values, softDelete.propertyName);
    values[softDelete.propertyName] = value;
    mutations.recordState(entry);
    entry.state = EntityState.Modified;
}
