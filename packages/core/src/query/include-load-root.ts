import type { EntityMetadata } from '../model/entity-metadata';
import type { IncludeLoadRoot } from './include-loader-context';
import { captureEntityPersistenceFacts } from '../tracking/entity-persistence-fact-capture';

export interface SuppliedIncludeValues {
    readonly modelValues: Readonly<Record<string, unknown>>;
    readonly boundValues: Readonly<Record<string, unknown>>;
}

export function captureIncludeRoots<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entities: readonly TEntity[],
    supplied?: ReadonlyMap<object, SuppliedIncludeValues>,
): Array<IncludeLoadRoot<TEntity>> {
    return entities.map(entity => {
        const captured = supplied?.get(entity) ??
            captureEntityPersistenceFacts(metadata, entity);
        return {
            entity,
            values: captured.modelValues,
            boundValues: captured.boundValues,
        };
    });
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
