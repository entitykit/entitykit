import type { EntityUpdateValues } from '../types';
import type { DebugSqlOptions } from '../sql/debug-sql';
import type { SqlStatement } from '../sql/sql-statement';
import type { AggregateProxy, AggregateResult, AggregateSelection, GroupKeyResult, GroupKeySelection } from './aggregate';
import type { OrderExpression } from './expression/order-expression';
import type { PredicateExpression } from './predicate-types';
import type { QueryField, QueryProxy } from './query-field-types';
import type { IncludeNavigationExpression, IncludeProxy, NavigationElement } from './include-types';
import type { JoinedQueryProxy, JoinTarget, NullableProjectionEntity } from './joined-proxy-types';
import type { JoinedQueryable } from './joined-query-types';
import type { ProjectionBuilder, ProjectionProxy, ProjectionResult, ProjectionSelection } from './projection';
import type { QueryPlan } from './query-plan';
import type { RelationNavigationExpression, RelationNavigationProxy, RelationPredicateSelector } from './relation-types';
import type { AggregateProjectedQueryable, GroupedQueryable, ProjectedQueryable } from './projected-query-types';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';

/** Immutable entity query with tracked materialization by default. */
export interface Queryable<TEntity extends object> {
    /**
     * Add a SQL predicate; successive calls combine with AND. Executes no SQL.
     * The callback receives query fields, not entity instances.
     * Use and()/or() or chained where(); JavaScript &&/|| discard predicates.
     */ where(selector: (entity: QueryProxy<TEntity>) => PredicateExpression): Queryable<TEntity>;
    /** Add a typed predicate when the condition is true. */ whereIf(condition: boolean, selector: (entity: QueryProxy<TEntity>) => PredicateExpression): Queryable<TEntity>;
    /** Filter by the existence of matching related rows. Does not load the relationship or execute SQL. */ whereHas<TNavigation>(selector: (
        entity: RelationNavigationProxy<TEntity>,
    ) => RelationNavigationExpression<TEntity, TNavigation>, predicateSelector?: RelationPredicateSelector<TNavigation>): Queryable<TEntity>;
    /** Filter by the absence of matching related rows. Does not load the relationship or execute SQL. */ whereDoesNotHave<TNavigation>(selector: (
        entity: RelationNavigationProxy<TEntity>,
    ) => RelationNavigationExpression<TEntity, TNavigation>, predicateSelector?: RelationPredicateSelector<TNavigation>): Queryable<TEntity>;
    /** Add order by to the query. */ orderBy<TProperty>(selector: (
        entity: QueryProxy<TEntity>,
    ) => QueryField<TProperty> | OrderExpression<TEntity>): Queryable<TEntity>;
    /** Add order by descending to the query. */ orderByDescending<TProperty>(selector: (
        entity: QueryProxy<TEntity>,
    ) => QueryField<TProperty> | OrderExpression<TEntity>): Queryable<TEntity>;
    /** Apply the skip row count. */ skip(count: number): Queryable<TEntity>;
    /** Apply the take row count. */ take(count: number): Queryable<TEntity>;
    /** Disable optional model query filters for this query; tenant isolation remains enforced. Executes no SQL. */ ignoreQueryFilters(): Queryable<TEntity>;
    /** Bypass tenant filtering for this query; soft-delete filtering remains. Executes no SQL. */ ignoreTenantScope(): Queryable<TEntity>;
    /** Materialize without retaining entities in the context tracker; query-local identity resolution remains. Executes no SQL here. */ asNoTracking(): Queryable<TEntity>;
    /** Request explicit relationship loading when the query executes. Returns a query supporting thenInclude(). */ include<TNavigation>(selector: (
        entity: IncludeProxy<TEntity>,
    ) => IncludeNavigationExpression<TEntity, TNavigation>): IncludeQueryable<TEntity, NavigationElement<TNavigation>>;
    /** Add a typed join source. */ join<TAlias extends string, TJoined extends object>(alias: TAlias, target: JoinTarget<TJoined>, selector: (
        sources: JoinedQueryProxy<TEntity, Record<TAlias, TJoined>>,
    ) => PredicateExpression): JoinedQueryable<TEntity, Record<TAlias, TJoined>, Record<TAlias, TJoined>>;
    /** Add a typed left join source. */ leftJoin<TAlias extends string, TJoined extends object>(alias: TAlias, target: JoinTarget<TJoined>, selector: (
        sources: JoinedQueryProxy<TEntity, Record<TAlias, TJoined>>,
    ) => PredicateExpression): JoinedQueryable<TEntity, Record<TAlias, TJoined>, Record<TAlias, NullableProjectionEntity<TJoined>>>;
    /** Project the current query into a typed read model. */ select<TSelection extends ProjectionSelection>(selector: (
        entity: ProjectionProxy<TEntity>, project: ProjectionBuilder,
    ) => TSelection): ProjectedQueryable<TEntity, ProjectionResult<TSelection>>;
    /** Build an aggregate projection; SQL executes at a terminal operation. */ aggregate<TSelection extends AggregateSelection>(selector: (
        aggregate: AggregateProxy<TEntity>,
    ) => TSelection): AggregateProjectedQueryable<AggregateResult<TSelection>>;
    /** Group by selected query fields; SQL executes at a terminal operation. */ groupBy<TSelection extends GroupKeySelection>(selector: (
        entity: QueryProxy<TEntity>,
    ) => TSelection): GroupedQueryable<TEntity, GroupKeyResult<TSelection>>;
    /** Execute the query and return all matching rows. */ toArray(options?: DatabaseOperationOptions): Promise<TEntity[]>;
    /** Stream matching entities with provider backpressure. */ stream(options?: QueryStreamOptions): AsyncIterable<TEntity>;
    /** Return the first matching row, or `null` when none exists. */ firstOrNull(options?: DatabaseOperationOptions): Promise<TEntity | null>;
    /** Return the first matching row, or throw when none exists. */ first(options?: DatabaseOperationOptions): Promise<TEntity>;
    /** Return the only matching row, `null` for none, or throw for multiple rows. */ singleOrNull(options?: DatabaseOperationOptions): Promise<TEntity | null>;
    /** Return the only matching row, or throw unless exactly one exists. */ single(options?: DatabaseOperationOptions): Promise<TEntity>;
    /** Return the number of matching rows. */ count(options?: DatabaseOperationOptions): Promise<number>;
    /** Return the number of matching rows without numeric precision loss. */ countBigInt(options?: DatabaseOperationOptions): Promise<bigint>;
    /** Return whether at least one row matches the query. */ exists(options?: DatabaseOperationOptions): Promise<boolean>;
    /** Execute an immediate update and return affected rows. Requires where(); bypasses the save pipeline without refreshing tracked objects. */ executeUpdate(values: EntityUpdateValues<TEntity>, options?: DatabaseOperationOptions): Promise<number>;
    /** Execute an immediate deletion and return affected rows. Requires where(); bypasses the save pipeline without detaching tracked objects. */ executeDelete(options?: DatabaseOperationOptions): Promise<number>;
    /** Build parameterized SQL without executing it. */ toSql(): SqlStatement;
    /** Render non-throwing diagnostic SQL with values redacted by default. */ toDebugSql(options?: DebugSqlOptions): string;
    /** Return the versioned, serializable query plan. */ toPlan(): QueryPlan;
}

/** Entity query that can continue an include path. */
export type IncludeQueryable<
    TEntity extends object,
    TCurrent extends object,
> = Omit<Queryable<TEntity>, 'stream'> & {
    /** Continue the explicit relationship-loading path. SQL executes with the parent query. */ thenInclude<TNavigation>(selector: (
        entity: IncludeProxy<TCurrent>,
    ) => IncludeNavigationExpression<TCurrent, TNavigation>): IncludeQueryable<TEntity, NavigationElement<TNavigation>>;
};

/** Caller-owned SQL that materializes mapped entities without ORM filtering. */
export interface UnsafeRawSqlQueryable<TEntity extends object> {
    /** Execute the query and return all matching rows. */ toArray(options?: DatabaseOperationOptions): Promise<TEntity[]>;
    /** Stream matching entities with provider backpressure. */ stream(options?: QueryStreamOptions): AsyncIterable<TEntity>;
    /** Opt into context tracking after validating the complete mapped shape. */
    asTracking(): UnsafeRawSqlQueryable<TEntity>;
    /** Return to the default untracked materialization behavior. */
    asNoTracking(): UnsafeRawSqlQueryable<TEntity>;
    /** Build parameterized SQL without executing it. */ toSql(): SqlStatement;
    /** Render non-throwing diagnostic SQL with values redacted by default. */ toDebugSql(options?: DebugSqlOptions): string;
}
