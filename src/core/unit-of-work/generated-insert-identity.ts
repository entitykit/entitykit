import type { PropertyMetadata } from '../../model/property-metadata';
import type { StoreValueReader } from '../../storage/store-value-reader';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { GeneratedValueRecorder } from './generated-value-recorder';
import { writeGeneratedValue } from './generated-value-writer';

/** Apply and record a provider insert ID when it is the entity's sole key. */
export function applyGeneratedInsertIdentity(
    entry: SavePlanEntry,
    properties: readonly PropertyMetadata[],
    insertId: unknown,
    mutations: SaveTimeMutationLog,
    recorder: GeneratedValueRecorder,
    valueReader?: StoreValueReader,
): PropertyMetadata | undefined {
    if (entry.state !== EntityState.Added || !hasInsertId(insertId)) {
        return undefined;
    }
    const generatedKeys = properties.filter(property => property.isPrimaryKey);
    if (generatedKeys.length !== 1) {
        return undefined;
    }
    const property = generatedKeys[0];
    const persistedValue = writeGeneratedValue(
        entry.entity,
        property,
        insertId,
        mutations,
        valueReader,
    );
    recorder.record(entry.entity, [{
        propertyName: property.propertyName,
        persistedValue,
    }]);
    return property;
}

function hasInsertId(value: unknown): boolean {
    return value !== undefined && value !== null &&
        value !== '' && value !== 0 && value !== 0n;
}
