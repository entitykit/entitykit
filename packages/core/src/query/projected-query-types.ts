import type {
    AggregateField,
    GroupedAggregateProxy,
    GroupedAggregateResult,
    GroupedAggregateSelection,
    GroupKeyField,
} from './aggregate';
import type { AggregateOrderExpression } from './aggregate-order-types';
import type { OrderExpression } from './expression/order-expression';
import type { HavingPredicateExpression, PredicateExpression } from './predicate-types';
import type { QueryField, QueryProxy } from './query-field-types';
import type { DebugSqlOptions } from '../sql/debug-sql';
import type { SqlStatement } from '../sql/sql-statement';
import type { QueryPlan } from './query-plan';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';

/** Terminal operations shared by untracked projected queries. */
export interface ProjectedQuery<TProjection extends Record<string, unknown>> {
    /** Execute the query and return all matching rows. */ toArray(options?: DatabaseOperationOptions): Promise<TProjection[]>;
    /** Stream matching projection rows with provider backpressure. */ stream(options?: QueryStreamOptions): AsyncIterable<TProjection>;
    /** Return the first matching row, or `null` when none exists. */ firstOrNull(options?: DatabaseOperationOptions): Promise<TProjection | null>;
    /** Return the first matching row, or throw when none exists. */ first(options?: DatabaseOperationOptions): Promise<TProjection>;
    /** Return the only matching row, `null` for none, or throw for multiple rows. */ singleOrNull(options?: DatabaseOperationOptions): Promise<TProjection | null>;
    /** Return the only matching row, or throw unless exactly one exists. */ single(options?: DatabaseOperationOptions): Promise<TProjection>;
    /** Return the number of matching rows. */ count(options?: DatabaseOperationOptions): Promise<number>;
    /** Return the number of matching rows without numeric precision loss. */ countBigInt(options?: DatabaseOperationOptions): Promise<bigint>;
    /** Return whether at least one row matches the query. */ exists(options?: DatabaseOperationOptions): Promise<boolean>;
    /** Build parameterized SQL without executing it. */ toSql(): SqlStatement;
    /** Render non-throwing diagnostic SQL with values redacted by default. */ toDebugSql(options?: DebugSqlOptions): string;
    /** Return the versioned, serializable query plan. */ toPlan(): QueryPlan;
}

/** Query builder produced by selecting fields from an entity query. */
export interface ProjectedQueryable<
    TEntity extends object,
    TProjection extends Record<string, unknown>,
> extends ProjectedQuery<TProjection> {
    /** Add a typed where predicate. */ where(
        selector: (entity: QueryProxy<TEntity>) => PredicateExpression,
    ): ProjectedQueryable<TEntity, TProjection>;
    /** Add a typed predicate when the condition is true. */ whereIf(
        condition: boolean,
        selector: (entity: QueryProxy<TEntity>) => PredicateExpression,
    ): ProjectedQueryable<TEntity, TProjection>;
    /** Add order by to the query. */ orderBy<TProperty>(selector: (
        entity: QueryProxy<TEntity>,
    ) => QueryField<TProperty> | OrderExpression<TEntity>): ProjectedQueryable<TEntity, TProjection>;
    /** Add order by descending to the query. */ orderByDescending<TProperty>(selector: (
        entity: QueryProxy<TEntity>,
    ) => QueryField<TProperty> | OrderExpression<TEntity>): ProjectedQueryable<TEntity, TProjection>;
    /** Apply the skip row count. */ skip(count: number): ProjectedQueryable<TEntity, TProjection>;
    /** Apply the take row count. */ take(count: number): ProjectedQueryable<TEntity, TProjection>;
    /** Perform the ignore query filters operation. */ ignoreQueryFilters(): ProjectedQueryable<TEntity, TProjection>;
    /** Perform the ignore tenant scope operation. */ ignoreTenantScope(): ProjectedQueryable<TEntity, TProjection>;
}

/** Terminal aggregate projection returned by aggregate and grouped queries. */
export type AggregateProjectedQueryable<
    TProjection extends Record<string, unknown>,
> = Omit<ProjectedQuery<TProjection>, 'count' | 'countBigInt' | 'exists'>;

/** Query stage produced by grouping an entity query. */
export interface GroupedQueryable<
    TEntity extends object,
    TKeySelection extends Record<string, unknown>,
> {
    /** Add a typed having predicate. */ having(selector: (
        group: GroupedAggregateProxy<TEntity, TKeySelection>,
    ) => HavingPredicateExpression): GroupedQueryable<TEntity, TKeySelection>;
    /** Add order by to the query. */ orderBy<TValue>(selector: (
        group: GroupedAggregateProxy<TEntity, TKeySelection>,
    ) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression): GroupedQueryable<TEntity, TKeySelection>;
    /** Add order by descending to the query. */ orderByDescending<TValue>(selector: (
        group: GroupedAggregateProxy<TEntity, TKeySelection>,
    ) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression): GroupedQueryable<TEntity, TKeySelection>;
    /** Apply the skip row count. */ skip(count: number): GroupedQueryable<TEntity, TKeySelection>;
    /** Apply the take row count. */ take(count: number): GroupedQueryable<TEntity, TKeySelection>;
    /** Project the current query into a typed read model. */ select<TSelection extends GroupedAggregateSelection>(selector: (
        group: GroupedAggregateProxy<TEntity, TKeySelection>,
    ) => TSelection): AggregateProjectedQueryable<GroupedAggregateResult<TSelection>>;
    /** Return the versioned, serializable query plan. */ toPlan(): QueryPlan;
}
