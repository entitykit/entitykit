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

export function uniqueIncludeRoots<TEntity extends object>(
    roots: ReadonlyArray<IncludeLoadRoot<TEntity>>,
): Array<IncludeLoadRoot<TEntity>> {
    const seen: Set<TEntity> = new Set();
    return roots.filter(root => {
        if (seen.has(root.entity)) return false;
        seen.add(root.entity);
        return true;
    });
}
