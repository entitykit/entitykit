import type { QueryModel } from './query-model';
import { AggregateQueryTerminals } from './aggregate-query-terminals';
import { snapshotJoinedQueryModel } from './query-model-snapshot';

/**
 * Terminal builder produced by `JoinedQueryable.aggregate(...)` and
 * `JoinedGroupedQueryable.select(...)`.
 *
 * Split out of `JoinedQuery.ts` because an aggregate projection is a terminal
 * query shape. It selects the joined model snapshot strategy while shared
 * execution and cardinality behavior live in `AggregateQueryTerminals`.
 */
export class JoinedAggregateProjectedQueryable<
    TRoot extends object,
    TProjection extends Record<string, unknown>,
> extends AggregateQueryTerminals<TRoot, TProjection> {

    public override toQueryModel(): QueryModel<TRoot> {
        return snapshotJoinedQueryModel(this.model);
    }
}
