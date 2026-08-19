import type { EntityMetadata } from '../model/entity-metadata';
import { cloneBoundEntityValues } from './bound-entity-value-clone';

/** Return the model key registered by the tracker, never a later live edit. */
export function persistedEntryKeyValue<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    boundValues: Readonly<Record<string, unknown>>,
): unknown {
    const keyValues = Object.fromEntries(metadata.keyProperties.map(property => [
        property,
        values[property],
    ]));
    const persisted = cloneBoundEntityValues(metadata, keyValues, boundValues);
    const key = metadata.keyProperties.map(property => persisted[property]);
    return metadata.hasCompositeKey ? key : key[0];
}
