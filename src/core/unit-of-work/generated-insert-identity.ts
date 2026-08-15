import type { PropertyMetadata } from '../../model/property-metadata';
import type { StoreValueReader } from '../../storage/store-value-reader';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { GeneratedValueRecorder } from './generated-value-recorder';
import { applyPreparedGeneratedValue } from './generated-value-writer';
import { prepareGeneratedValue } from './prepared-generated-value';
import type { RestorationScope } from '../../restoration-scope';

/** Apply and record a provider insert ID when it is the entity's sole key. */
export function applyGeneratedInsertIdentity(
    entry: SavePlanEntry,
    properties: readonly PropertyMetadata[],
    insertId: unknown,
    mutations: SaveTimeMutationLog,
    recorder: GeneratedValueRecorder,
    persistedBoundValues: Readonly<Record<string, unknown>>,
    scope: RestorationScope,
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
    const prepared = prepareGeneratedValue(
        property,
        insertId,
        valueReader,
        entry.entityName,
    );
    const tracked = recorder.register(
        entry.entity,
        [prepared],
        persistedBoundValues,
    );
    recorder.recordApplied(tracked, [applyPreparedGeneratedValue(
        entry.entity,
        prepared,
        mutations,
        scope,
        undefined,
    )]);
    return property;
}

function hasInsertId(value: unknown): boolean {
    return value !== undefined && value !== null &&
        value !== '' && value !== 0 && value !== 0n;
}
