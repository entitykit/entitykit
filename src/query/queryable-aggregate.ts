import type { QueryModel } from './query-model';
import { snapshotQueryModel } from './query-model-snapshot';
import { AggregateQueryTerminals } from './aggregate-query-terminals';

/**
 * Terminal builder for an aggregate/grouped projection.
 *
 * Split out of `Queryable.ts` because it is the read-only end of the aggregate
 * pipeline. It selects the entity-shaped model snapshot strategy while shared
 * execution and cardinality behavior live in `AggregateQueryTerminals`.
 */
export class AggregateProjectedQueryable<
    TEntity extends object,
    TProjection extends Record<string, unknown>,
> extends AggregateQueryTerminals<TEntity, TProjection> {

    public override toQueryModel(): QueryModel<TEntity> {
        return snapshotQueryModel(this.model);
    }
}
