import type { EntityMetadata } from '../model/entity-metadata';
import { fromBoundPropertyValue } from '../model/value-converter/store-value';
import {
    cloneSnapshotValue,
    snapshotPropertyValue,
} from './snapshot-value';

/** Clone captured model values without reconverting properties with bound facts. */
export function cloneBoundEntityValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Record<string, unknown>,
    boundValues: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        const property = metadata.tryGetProperty(key);
        cloned[key] = property?.converter && Object.prototype.hasOwnProperty.call(
            boundValues,
            key,
        )
            ? fromBoundPropertyValue(
                cloneSnapshotValue(boundValues[key]),
                property,
                metadata.entityName,
            )
            : snapshotPropertyValue(
                value,
                property?.converter,
                `${metadata.entityName}.${key}`,
            );
    }
    return cloned;
}
