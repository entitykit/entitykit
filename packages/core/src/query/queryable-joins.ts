import type { PredicateExpression } from './predicate-types';
import type {
    JoinedQueryProxy,
    JoinTarget,
    NullableProjectionEntity,
} from './joined-proxy-types';
import { JoinedQueryable } from './joined-query/queryable';
import { QueryableTerminals } from './queryable-terminals';

// The initial join scope deliberately has no aliases; the first join adds one.
// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- Empty keys are intentional here.
type EmptyJoinedSources = Record<never, object>;

/**
 * Shape-changing joins available from an entity query.
 */
export abstract class QueryableJoins<TEntity extends object> extends QueryableTerminals<TEntity> {
    public join<TAlias extends string, TJoined extends object>(
        alias: TAlias,
        target: JoinTarget<TJoined>,
        selector: (sources: JoinedQueryProxy<TEntity, Record<TAlias, TJoined>>) => PredicateExpression,
    ): JoinedQueryable<TEntity, Record<TAlias, TJoined>, Record<TAlias, TJoined>> {
        return new JoinedQueryable<
            TEntity,
            EmptyJoinedSources,
            EmptyJoinedSources
        >(this.metadata, this.executor, this.toQueryModel())
            .join(alias, target, selector);
    }

    public leftJoin<TAlias extends string, TJoined extends object>(
        alias: TAlias,
        target: JoinTarget<TJoined>,
        selector: (sources: JoinedQueryProxy<TEntity, Record<TAlias, TJoined>>) => PredicateExpression,
    ): JoinedQueryable<TEntity, Record<TAlias, TJoined>, Record<TAlias, NullableProjectionEntity<TJoined>>> {
        return new JoinedQueryable<
            TEntity,
            EmptyJoinedSources,
            EmptyJoinedSources
        >(this.metadata, this.executor, this.toQueryModel())
            .leftJoin(alias, target, selector);
    }
}
