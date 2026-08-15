import { snapshotPropertyValueCopies } from '../tracking/snapshot-value';
import { toBoundProviderValue } from '../model/value-converter/store-value';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import type { SaveTimeMutationLog } from './save-time-mutations';
import { ensurePolicyPropertyPath } from './policy-property-path';
import type { RestorationScope } from '../restoration-scope';
import { writeFailureAtomicProperty } from '../failure-atomic-property-write';

/** Write distinct persisted and live copies of one save-time policy value. */
export function writeSaveTimeProperty(
    snapshot: PersistedEntrySnapshot,
    propertyName: string,
    suppliedValue: unknown,
    mutations: SaveTimeMutationLog,
    scope: RestorationScope,
    validatePersistedValue?: (value: unknown) => void,
): void {
    const { entry } = snapshot;
    const property = entry.metadata.getProperty(propertyName);
    const { providerValue, persistedValue, liveValue } = snapshotPropertyValueCopies(
        suppliedValue,
        property.converter,
        `${entry.metadata.entityName}.${propertyName}`,
    );
    const context = `${entry.metadata.entityName}.${propertyName}`;
    validatePersistedValue?.(persistedValue);
    ensurePolicyPropertyPath(
        entry.metadata,
        entry.entity,
        property,
        mutations,
        scope,
    );
    writeFailureAtomicProperty({
        entity: entry.entity,
        property,
        value: liveValue,
        scope,
        context,
        recordApplied: (previous, applied) => {
            mutations.recordApplied(
                entry.entity,
                property,
                previous,
                applied,
                context,
            );
        },
    });
    snapshot.values[propertyName] = persistedValue;
    snapshot.boundValues[propertyName] = cloneSnapshotValue(
        toBoundProviderValue(providerValue, property.columnType, context),
    );
}
