import { snapshotPropertyValueCopies } from '../tracking/snapshot-value';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import type { SaveTimeMutationLog } from './save-time-mutations';

/** Write distinct persisted and live copies of one save-time policy value. */
export function writeSaveTimeProperty(
    snapshot: PersistedEntrySnapshot,
    propertyName: string,
    suppliedValue: unknown,
    mutations: SaveTimeMutationLog,
): void {
    const { entry } = snapshot;
    const property = entry.metadata.getProperty(propertyName);
    const { persistedValue, liveValue } = snapshotPropertyValueCopies(
        suppliedValue,
        property.converter,
        `${entry.metadata.entityName}.${propertyName}`,
    );
    const liveValues = entry.entity as Record<string, unknown>;
    mutations.recordApplied(
        liveValues,
        propertyName,
        snapshot.values[propertyName],
        liveValue,
    );
    snapshot.values[propertyName] = persistedValue;
    liveValues[propertyName] = liveValue;
}
