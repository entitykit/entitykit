import { snapshotPropertyValueCopies } from '../tracking/snapshot-value';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import type { SaveTimeMutationLog } from './save-time-mutations';
import {
    readPropertyValue,
    writePropertyValue,
} from '../model/property-value-access';
import { ensurePolicyPropertyPath } from './policy-property-path';

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
    const context = `${entry.metadata.entityName}.${propertyName}`;
    ensurePolicyPropertyPath(
        entry.metadata,
        entry.entity,
        property,
        mutations,
    );
    const previousLiveValue = readPropertyValue(entry.entity, property);
    writePropertyValue(entry.entity, property, liveValue);
    mutations.recordApplied(
        entry.entity,
        property,
        previousLiveValue,
        readPropertyValue(entry.entity, property),
        context,
    );
    snapshot.values[propertyName] = persistedValue;
}
