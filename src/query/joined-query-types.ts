import type {
    AggregateField,
    AggregateProxy,
    AggregateResult,
    AggregateSelection,
    GroupedAggregateProxy,
    GroupedAggregateResult,
    GroupedAggregateSelection,
    GroupKeyField,
    GroupKeyResult,
    GroupKeySelection,
} from './aggregate';
import type { AggregateOrderExpression } from './aggregate-order-types';
import type { HavingPredicateExpression, PredicateExpression } from './predicate-types';
import type { OrderExpression } from './expression/order-expression';
import type { QueryField } from './query-field-types';
import type { JoinedProjectionProxy, JoinedQueryProxy, JoinTarget, NullableProjectionEntity } from './joined-proxy-types';
import type { ProjectionBuilder, ProjectionResult, ProjectionSelection } from './projection';
import type { QueryPlan } from './query-plan';
import type { AggregateProjectedQueryable, ProjectedQuery } from './projected-query-types';
import type { DatabaseOperationOptions } from '../storage/database-connection';

/** Joined query stage used for filtering, shaping, grouping, and further joins. */
export interface JoinedQueryable<
    TRoot extends object,
    TJoined extends Record<string, object>,
    TProjectionJoined extends Record<string, object> = TJoined,
> {
    /** Add a typed where predicate. */ where(selector: (
        sources: JoinedQueryProxy<TRoot, TJoined>,
    ) => PredicateExpression): JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    /** Add a typed predicate when the condition is true. */ whereIf(condition: boolean, selector: (
        sources: JoinedQueryProxy<TRoot, TJoined>,
    ) => PredicateExpression): JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    /** Add order by to the query. */ orderBy<TProperty>(selector: (
        sources: JoinedQueryProxy<TRoot, TJoined>,
    ) => QueryField<TProperty> | OrderExpression<Record<string, unknown>>): JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    /** Add order by descending to the query. */ orderByDescending<TProperty>(selector: (
        sources: JoinedQueryProxy<TRoot, TJoined>,
    ) => QueryField<TProperty> | OrderExpression<Record<string, unknown>>): JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    /** Apply the skip row count. */ skip(count: number): JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    /** Apply the take row count. */ take(count: number): JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    /** Perform the ignore query filters operation. */ ignoreQueryFilters(): JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    /** Perform the ignore tenant scope operation. */ ignoreTenantScope(): JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    /** Return the number of matching rows. */ count(options?: DatabaseOperationOptions): Promise<number>;
    /** Return the number of matching rows without numeric precision loss. */ countBigInt(options?: DatabaseOperationOptions): Promise<bigint>;
    /** Return whether at least one row matches the query. */ exists(options?: DatabaseOperationOptions): Promise<boolean>;
    /** Return the versioned, serializable query plan. */ toPlan(): QueryPlan;
    /** Project the current query into a typed read model. */ select<TSelection extends ProjectionSelection>(selector: (
        sources: JoinedProjectionProxy<TRoot, TProjectionJoined>,
        project: ProjectionBuilder,
    ) => TSelection): JoinedProjectedQueryable<TRoot, TJoined, ProjectionResult<TSelection>>;
    /** Perform the aggregate operation. */ aggregate<TSelection extends AggregateSelection>(selector: (
        aggregate: AggregateProxy<TRoot, JoinedQueryProxy<TRoot, TProjectionJoined>>,
    ) => TSelection): AggregateProjectedQueryable<AggregateResult<TSelection>>;
    /** Perform the group by operation. */ groupBy<TSelection extends GroupKeySelection>(selector: (
        sources: JoinedQueryProxy<TRoot, TProjectionJoined>,
    ) => TSelection): JoinedGroupedQueryable<TRoot, TProjectionJoined, GroupKeyResult<TSelection>>;
    /** Add a typed join source. */ join<TAlias extends string, TEntity extends object>(alias: TAlias, target: JoinTarget<TEntity>, selector: (
        sources: JoinedQueryProxy<TRoot, TJoined & Record<TAlias, TEntity>>,
    ) => PredicateExpression): JoinedQueryable<TRoot, TJoined & Record<TAlias, TEntity>, TProjectionJoined & Record<TAlias, TEntity>>;
    /** Add a typed left join source. */ leftJoin<TAlias extends string, TEntity extends object>(alias: TAlias, target: JoinTarget<TEntity>, selector: (
        sources: JoinedQueryProxy<TRoot, TJoined & Record<TAlias, TEntity>>,
    ) => PredicateExpression): JoinedQueryable<TRoot, TJoined & Record<TAlias, TEntity>, TProjectionJoined & Record<TAlias, NullableProjectionEntity<TEntity>>>;
}

/** Projected rows produced by a joined query. */
export interface JoinedProjectedQueryable<
    TRoot extends object,
    TJoined extends Record<string, object>,
    TProjection extends Record<string, unknown>,
> extends ProjectedQuery<TProjection> {
    /** Add a typed where predicate. */ where(selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => PredicateExpression): JoinedProjectedQueryable<TRoot, TJoined, TProjection>;
    /** Add a typed predicate when the condition is true. */ whereIf(condition: boolean, selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => PredicateExpression): JoinedProjectedQueryable<TRoot, TJoined, TProjection>;
    /** Add order by to the query. */ orderBy<TProperty>(selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => QueryField<TProperty> | OrderExpression<Record<string, unknown>>): JoinedProjectedQueryable<TRoot, TJoined, TProjection>;
    /** Add order by descending to the query. */ orderByDescending<TProperty>(selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => QueryField<TProperty> | OrderExpression<Record<string, unknown>>): JoinedProjectedQueryable<TRoot, TJoined, TProjection>;
    /** Apply the skip row count. */ skip(count: number): JoinedProjectedQueryable<TRoot, TJoined, TProjection>;
    /** Apply the take row count. */ take(count: number): JoinedProjectedQueryable<TRoot, TJoined, TProjection>;
    /** Perform the ignore query filters operation. */ ignoreQueryFilters(): JoinedProjectedQueryable<TRoot, TJoined, TProjection>;
    /** Perform the ignore tenant scope operation. */ ignoreTenantScope(): JoinedProjectedQueryable<TRoot, TJoined, TProjection>;
}

/** Grouping stage produced by a joined query. */
export interface JoinedGroupedQueryable<TRoot extends object, TJoined extends Record<string, object>, TKeySelection extends Record<string, unknown>> {
    /** Add a typed having predicate. */ having(selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => HavingPredicateExpression): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection>;
    /** Add order by to the query. */ orderBy<TValue>(selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection>;
    /** Add order by descending to the query. */ orderByDescending<TValue>(selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection>;
    /** Apply the skip row count. */ skip(count: number): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection>;
    /** Apply the take row count. */ take(count: number): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection>;
    /** Project the current query into a typed read model. */ select<TSelection extends GroupedAggregateSelection>(selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => TSelection): AggregateProjectedQueryable<GroupedAggregateResult<TSelection>>;
    /** Return the versioned, serializable query plan. */ toPlan(): QueryPlan;
}
