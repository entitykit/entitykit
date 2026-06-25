import type { EntityMetadata } from '../model/entity-metadata';
import { cloneQueryModel, type QueryModel } from './query-model';
import { snapshotQueryModel } from './query-model-snapshot';
import {
    createGroupedAggregateExpressions,
    createGroupedAggregateProxy,
    type AggregateField,
    type GroupedAggregateProxy,
    type GroupedAggregateResult,
    type GroupedAggregateSelection,
    type GroupKeyField,
} from './aggregate';
import type { AggregateOrderExpression } from './aggregate-order-types';
import type { HavingPredicateExpression } from './predicate-types';
import { AggregateProjectedQueryable } from './queryable-aggregate';
import {
    assertHavingPredicateExpression,
    assertNonNegativeInteger,
    normalizeAggregateOrdering,
    type QueryExecutor,
} from './queryable-helpers';
import { createQueryPlan, type QueryPlan } from './query-plan';

/**
 * Builder produced by `Queryable.groupBy()`.
 *
 * Split out of `Queryable.ts` because grouping has its own vocabulary — `having`,
 * grouped ordering, and a `select` that terminates in an
 * `AggregateProjectedQueryable` — none of which the entity builder shares. It
 * depends only on the aggregate terminal and the shared helpers, never back on
 * `Queryable`, so it sits below it in the import graph.
 */
export class GroupedQueryable<TEntity extends object, TKeySelection extends Record<string, unknown>> {
    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly executor: QueryExecutor<TEntity>,
        private readonly model: QueryModel<TEntity>,
    ) {}

    public having(
        selector: (group: GroupedAggregateProxy<TEntity, TKeySelection>) => HavingPredicateExpression,
    ): GroupedQueryable<TEntity, TKeySelection> {
        const predicate = selector(createGroupedAggregateProxy<TEntity, TKeySelection>(this.model.groupKeys ?? []));
        assertHavingPredicateExpression(predicate, 'having selectors');
        const combined = this.model.having ? this.model.having.and(predicate) : predicate;
        return new GroupedQueryable(this.metadata, this.executor, cloneQueryModel(this.model, { having: combined }));
    }

    public toPlan(): QueryPlan {
        return createQueryPlan(this.model);
    }

    public orderBy<TValue>(
        selector: (group: GroupedAggregateProxy<TEntity, TKeySelection>) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression,
    ): GroupedQueryable<TEntity, TKeySelection> {
        return this.addAggregateOrdering(selector, 'asc');
    }

    public orderByDescending<TValue>(
        selector: (group: GroupedAggregateProxy<TEntity, TKeySelection>) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression,
    ): GroupedQueryable<TEntity, TKeySelection> {
        return this.addAggregateOrdering(selector, 'desc');
    }

    public skip(count: number): GroupedQueryable<TEntity, TKeySelection> {
        assertNonNegativeInteger(count, 'grouped skip');
        return new GroupedQueryable(this.metadata, this.executor, cloneQueryModel(this.model, { offset: count }));
    }

    public take(count: number): GroupedQueryable<TEntity, TKeySelection> {
        assertNonNegativeInteger(count, 'grouped take');
        return new GroupedQueryable(this.metadata, this.executor, cloneQueryModel(this.model, { limit: count }));
    }

    public select<TSelection extends GroupedAggregateSelection>(
        selector: (group: GroupedAggregateProxy<TEntity, TKeySelection>) => TSelection,
    ): AggregateProjectedQueryable<TEntity, GroupedAggregateResult<TSelection>> {
        const projection = createGroupedAggregateExpressions(
            selector(createGroupedAggregateProxy<TEntity, TKeySelection>(this.model.groupKeys ?? [])),
        );
        return new AggregateProjectedQueryable<TEntity, GroupedAggregateResult<TSelection>>(
            this.metadata,
            this.executor,
            cloneQueryModel(this.model, {
                aggregateProjection: projection.aggregateProjection,
                groupKeyProjection: projection.groupKeyProjection,
            }),
        );
    }

    public toQueryModel(): QueryModel<TEntity> {
        return snapshotQueryModel(this.model);
    }

    private addAggregateOrdering<TValue>(
        selector: (group: GroupedAggregateProxy<TEntity, TKeySelection>) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression,
        defaultDirection: 'asc' | 'desc',
    ): GroupedQueryable<TEntity, TKeySelection> {
        const selected = selector(createGroupedAggregateProxy<TEntity, TKeySelection>(this.model.groupKeys ?? []));
        const ordering = normalizeAggregateOrdering(selected, defaultDirection);
        return new GroupedQueryable(this.metadata, this.executor, cloneQueryModel(this.model, {
            aggregateOrderings: [...this.model.aggregateOrderings ?? [], ordering],
        }));
    }
}
