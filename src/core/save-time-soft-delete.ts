import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { writeSaveTimeProperty } from './save-time-property-write';
import { assertSoftDeletePersistedValue } from '../model/soft-delete-metadata-validation';

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
    writeSaveTimeProperty(
        snapshot,
        softDelete.propertyName,
        value,
        mutations,
        persistedValue => {
            assertSoftDeletePersistedValue(
                entry.metadata.entityName,
                softDelete.propertyName,
                persistedValue,
            );
        },
    );
    mutations.recordAppliedState(
        entry,
        entry.state,
        EntityState.Modified,
    );
    entry.transitionToState(EntityState.Modified);
    return { ...snapshot, state: EntityState.Modified };
}
