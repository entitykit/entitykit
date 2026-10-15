import type { EntityMetadata } from '../model/entity-metadata';
import type { MaterializedRow } from '../materialization/materialized-row';
import type { Materializer } from '../materialization/materializer';
import type { ChangeTracker } from '../tracking/change-tracker';

export type EntityQueryResult<TEntity extends object> =
    | { readonly kind: 'entities'; readonly rows: TEntity[] }
    | { readonly kind: 'roots'; readonly rows: Array<MaterializedRow<TEntity>> };

/** Only include graphs need per-row captures after entity materialization. */
export function materializeEntityQueryResult<TEntity extends object>(
    materializer: Materializer,
    metadata: EntityMetadata<TEntity>,
    rows: ReadonlyArray<Record<string, unknown>>,
    tracker: ChangeTracker,
    hasIncludes: boolean,
): EntityQueryResult<TEntity> {
    return hasIncludes
        ? { kind: 'roots', rows: materializer.materializeManyWithValues(metadata, rows, tracker) }
        : { kind: 'entities', rows: materializer.materializeMany(metadata, rows, tracker) };
}
