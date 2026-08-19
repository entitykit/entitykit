import type { EntityMetadata } from '../model/entity-metadata';
import { cloneBoundEntityValues } from './bound-entity-value-clone';
import {
    captureTrackedBoundEntityValues,
    cloneBoundValues,
} from './bound-value-snapshot';
import { cloneEntityValues, readEntityValues } from './entity-entry-snapshot';

export interface InitialTrackedEntrySnapshot {
    readonly values: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
}

export function captureInitialTrackedEntrySnapshot<TEntity extends object>(
    entity: TEntity,
    metadata: EntityMetadata<TEntity>,
    originalValues?: Record<string, unknown>,
    originalBoundValues?: Record<string, unknown>,
): InitialTrackedEntrySnapshot {
    const values = originalValues
        ? originalBoundValues
            ? cloneBoundEntityValues(metadata, originalValues, originalBoundValues)
            : cloneEntityValues(metadata, originalValues)
        : readEntityValues(metadata, entity);
    return {
        values,
        boundValues: originalBoundValues
            ? cloneBoundValues(originalBoundValues)
            : captureTrackedBoundEntityValues(metadata, values),
    };
}
