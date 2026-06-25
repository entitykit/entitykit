import type { EntityMetadata } from '../model/entity-metadata';
import { cloneQueryModel, type QueryModel } from './query-model';
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
import type { QueryExecutor } from './queryable-helpers';
import { JoinedAggregateProjectedQueryable } from './joined-query-aggregate';
import { normalizeAggregateOrdering } from './joined-query-ordering';
import {
    createJoinedQueryProxy,
    type JoinedQueryProxy,
} from './joined-query-proxy';
import {
    assertHavingPredicateExpression,
    assertNonNegativeInteger,
} from './joined-query-validation';
import { snapshotJoinedQueryModel } from './query-model-snapshot';
import { createQueryPlan, type QueryPlan } from './query-plan';

/**
 * Builder produced by `JoinedQueryable.groupBy(...)`.
 *
 * Split out of `JoinedQuery.ts` because grouping is its own query stage: it adds
 * `having` and grouped ordering over the group-key/aggregate proxy, then hands
 * off to `JoinedAggregateProjectedQueryable` on `select(...)`. It imports that
 * terminal builder (a value-level leaf) and the shared helpers, but never the
 * root `JoinedQueryable`, so the dependency edge points one way and forms no
 * import cycle.
 */
export class JoinedGroupedQueryable<
    TRoot extends object,
    TJoined extends Record<string, object>,
    TKeySelection extends Record<string, unknown>,
> {
    constructor(
        private readonly rootMetadata: EntityMetadata<TRoot>,
        private readonly executor: QueryExecutor<TRoot>,
        private readonly model: QueryModel<TRoot>,
    ) {}

    public toPlan(): QueryPlan {
        return createQueryPlan(this.model);
    }

    public having(
        selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => HavingPredicateExpression,
    ): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection> {
        const predicate = selector(this.groupedAggregateProxy());
        assertHavingPredicateExpression(predicate, 'joined aggregate having selectors');
        const combined = this.model.having ? this.model.having.and(predicate) : predicate;
        return new JoinedGroupedQueryable(this.rootMetadata, this.executor, cloneQueryModel(this.model, { having: combined }));
    }

    public orderBy<TValue>(
        selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression,
    ): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection> {
        return this.addAggregateOrdering(selector, 'asc');
    }

    public orderByDescending<TValue>(
        selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression,
    ): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection> {
        return this.addAggregateOrdering(selector, 'desc');
    }

    public skip(count: number): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection> {
        assertNonNegativeInteger(count, 'joined grouped skip');
        return new JoinedGroupedQueryable(this.rootMetadata, this.executor, cloneQueryModel(this.model, { offset: count }));
    }

    public take(count: number): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection> {
        assertNonNegativeInteger(count, 'joined grouped take');
        return new JoinedGroupedQueryable(this.rootMetadata, this.executor, cloneQueryModel(this.model, { limit: count }));
    }

    public select<TSelection extends GroupedAggregateSelection>(
        selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => TSelection,
    ): JoinedAggregateProjectedQueryable<TRoot, GroupedAggregateResult<TSelection>> {
        const projection = createGroupedAggregateExpressions(selector(this.groupedAggregateProxy()));
        return new JoinedAggregateProjectedQueryable<TRoot, GroupedAggregateResult<TSelection>>(
            this.rootMetadata,
            this.executor,
            cloneQueryModel(this.model, {
                aggregateProjection: projection.aggregateProjection,
                groupKeyProjection: projection.groupKeyProjection,
            }),
        );
    }

    public toQueryModel(): QueryModel<TRoot> {
        return snapshotJoinedQueryModel(this.model);
    }

    private addAggregateOrdering<TValue>(
        selector: (group: GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>) => AggregateField<TValue> | GroupKeyField<TValue> | AggregateOrderExpression,
        defaultDirection: 'asc' | 'desc',
    ): JoinedGroupedQueryable<TRoot, TJoined, TKeySelection> {
        const selected = selector(this.groupedAggregateProxy());
        const ordering = normalizeAggregateOrdering(selected, defaultDirection);
        return new JoinedGroupedQueryable(this.rootMetadata, this.executor, cloneQueryModel(this.model, {
            aggregateOrderings: [...this.model.aggregateOrderings ?? [], ordering],
        }));
    }

    private groupedAggregateProxy(): GroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>> {
        return createGroupedAggregateProxy<TRoot, TKeySelection, JoinedQueryProxy<TRoot, TJoined>>(
            this.model.groupKeys ?? [],
            createJoinedQueryProxy<TRoot, TJoined>(this.joinAliases()),
        );
    }

    private joinAliases(): string[] {
        return this.model.joins.map(join => join.alias);
    }
}
