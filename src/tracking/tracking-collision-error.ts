import type { EntityMetadata } from '../model/entity-metadata';
import { EntityState } from './entity-state';

export function trackingCollisionError<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    state: EntityState,
): Error {
    const keyValues = metadata.keyProperties.map(
        propertyName => values[propertyName],
    );
    const key = String(
        metadata.hasCompositeKey ? keyValues : keyValues[0],
    );
    return state === EntityState.Unchanged
        ? new Error(
            `Another instance of '${metadata.entityName}' with key '${key}' ` +
            'is already tracked. The supplied instance was not attached.',
        )
        : new Error(
            `An instance of '${metadata.entityName}' with key '${key}' ` +
            'is already tracked.',
        );
}
