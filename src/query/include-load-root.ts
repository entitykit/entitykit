import type { EntityMetadata } from '../model/entity-metadata';
import { readEntityValues } from '../tracking/entity-entry-snapshot';
import type { IncludeLoadRoot } from './include-loader-context';

export function captureIncludeRoots<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entities: readonly TEntity[],
    supplied?: ReadonlyMap<object, Readonly<Record<string, unknown>>>,
): Array<IncludeLoadRoot<TEntity>> {
    return entities.map(entity => ({
        entity,
        values: supplied?.get(entity) ?? readEntityValues(metadata, entity),
    }));
}
