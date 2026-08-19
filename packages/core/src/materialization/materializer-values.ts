import type { EntityMetadata } from '../model/entity-metadata';
import { applyMaterializedValues } from './complex-value-materializer';

export function createMaterializerValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    originalValues: Readonly<Record<string, unknown>>,
): Partial<TEntity> {
    const values = {} as TEntity;
    applyMaterializedValues(metadata, values, originalValues);
    return values;
}
