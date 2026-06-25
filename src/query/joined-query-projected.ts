import type { OrderExpression } from './expression/order-expression';
import type { PredicateExpression } from './expression/predicate-expression';
import type { QueryField } from './expression/query-field';
import { cloneQueryModel, type QueryModel } from './query-model';
import { snapshotJoinedQueryModel } from './query-model-snapshot';
import { ProjectedQueryTerminals } from './projected-query-terminals';
import {
    normalizeOrdering,
    type JoinedOrderExpression,
} from './joined-query-ordering';
import {
    createJoinedQueryProxy,
    type JoinedQueryProxy,
} from './joined-query-proxy';
import {
    assertNonNegativeInteger,
    assertPredicateExpression,
} from './joined-query-validation';

/**
 * Builder produced by `JoinedQueryable.select(...)`.
 *
 * Split out of `JoinedQuery.ts` because a joined projection is a distinct query
 * shape. Joined-proxy filtering and ordering stay here, shared projected
 * terminal execution is inherited, and the join-building surface is omitted.
 * It only ever constructs another `JoinedProjectedQueryable`.
 */
export class JoinedProjectedQueryable<
    TRoot extends object,
    TJoined extends Record<string, object>,
    TProjection extends Record<string, unknown>,
> extends ProjectedQueryTerminals<TRoot, TProjection> {

    public where(selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => PredicateExpression): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        const predicate = selector(createJoinedQueryProxy<TRoot, TJoined>(this.joinAliases()));
        assertPredicateExpression(predicate, 'joined projection where selectors');
        const combined = this.model.predicate ? this.model.predicate.and(predicate) : predicate;
        return this.with({ predicate: combined });
    }

    public whereIf(
        condition: boolean,
        selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => PredicateExpression,
    ): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        return condition ? this.where(selector) : this;
    }

    public orderBy<TProperty>(
        selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => QueryField<TProperty> | JoinedOrderExpression,
    ): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        return this.addOrdering(selector, 'asc');
    }

    public orderByDescending<TProperty>(
        selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => QueryField<TProperty> | JoinedOrderExpression,
    ): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        return this.addOrdering(selector, 'desc');
    }

    public skip(count: number): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        assertNonNegativeInteger(count, 'skip');
        return this.with({ offset: count });
    }

    public take(count: number): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        assertNonNegativeInteger(count, 'take');
        return this.with({ limit: count });
    }

    public ignoreQueryFilters(): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        return this.with({ ignoreQueryFilters: true });
    }

    /** Join and project across every tenant. See `Queryable.ignoreTenantScope`. */
    public ignoreTenantScope(): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        return this.with({ ignoreTenantScope: true });
    }

    public override toQueryModel(): QueryModel<TRoot> {
        return snapshotJoinedQueryModel(this.model);
    }

    protected override with(
        changes: Partial<Omit<QueryModel<TRoot>, 'entityType'>>,
    ): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        return new JoinedProjectedQueryable(this.metadata, this.executor, cloneQueryModel(this.model, changes));
    }

    private addOrdering<TProperty>(
        selector: (sources: JoinedQueryProxy<TRoot, TJoined>) => QueryField<TProperty> | JoinedOrderExpression,
        defaultDirection: 'asc' | 'desc',
    ): JoinedProjectedQueryable<TRoot, TJoined, TProjection> {
        const selected = selector(createJoinedQueryProxy<TRoot, TJoined>(this.joinAliases()));
        const ordering = normalizeOrdering(selected, defaultDirection) as OrderExpression<TRoot>;
        return this.with({ orderings: [...this.model.orderings, ordering] });
    }

    private joinAliases(): string[] {
        return this.model.joins.map(join => join.alias);
    }
}
