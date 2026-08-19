import type { EntityMetadata } from '../model/entity-metadata';
import { assertSynchronousCallbackResult } from '../synchronous-callback';
import { createMaterializerValues } from './materializer-values';

/** Construct an entity without applying database row values to it. */
export function constructMaterializedEntity<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
): TEntity {
    const created: unknown = metadata.materializer
        ? metadata.materializer(createMaterializerValues(metadata, values))
        : new (metadata.ctor as unknown as new () => TEntity)();
    assertSynchronousCallbackResult(
        created,
        `Entity materializer for '${metadata.entityName}'`,
        message => new TypeError(message),
    );
    if (
        created === null ||
        created === undefined ||
        typeof created !== 'object' && typeof created !== 'function'
    ) {
        throw new TypeError(
            `Entity materializer for '${metadata.entityName}' must return an object.`,
        );
    }
    return created as TEntity;
}

export function reusedMaterializedEntityError(
    entityName: string,
): TypeError {
    return new TypeError(
        `Entity materializer for '${entityName}' returned an entity instance ` +
        'already used for another database row. ' +
        'A materializer must return a fresh instance.',
    );
}
