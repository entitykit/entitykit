import type { OrderExpression } from '../expression/order-expression';
import type { PredicateExpression } from '../expression/predicate-expression';
import type { QueryField } from '../expression/query-field';
import {
    normalizeOrdering,
    type JoinedOrderExpression,
} from '../joined-query-ordering';
import {
    createJoinedQueryProxy,
    type JoinedQueryProxy,
} from '../joined-query-proxy';
import {
    assertNonNegativeInteger,
    assertPredicateExpression,
} from '../joined-query-validation';
import type { JoinedQueryable } from './queryable';
import { JoinedQueryableState } from './queryable-state';

export class JoinedQueryFilters<
    TRoot extends object,
    TJoined extends Record<string, object>,
    TProjectionJoined extends Record<string, object>,
> extends JoinedQueryableState<TRoot, TJoined, TProjectionJoined> {
    public where(
        selector: (
            sources: JoinedQueryProxy<TRoot, TJoined>,
        ) => PredicateExpression,
    ): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        const predicate = selector(
            createJoinedQueryProxy<TRoot, TJoined>(this.joinAliases()),
        );
        assertPredicateExpression(predicate, 'joined where selectors');
        const combined = this.model.predicate
            ? this.model.predicate.and(predicate)
            : predicate;
        return this.with({ predicate: combined });
    }

    public whereIf(
        condition: boolean,
        selector: (
            sources: JoinedQueryProxy<TRoot, TJoined>,
        ) => PredicateExpression,
    ): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        return condition
            ? this.where(selector)
            : this as unknown as JoinedQueryable<TRoot, TJoined, TProjectionJoined>;
    }

    public orderBy<TProperty>(
        selector: (
            sources: JoinedQueryProxy<TRoot, TJoined>,
        ) => QueryField<TProperty> | JoinedOrderExpression,
    ): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        return this.addOrdering(selector, 'asc');
    }

    public orderByDescending<TProperty>(
        selector: (
            sources: JoinedQueryProxy<TRoot, TJoined>,
        ) => QueryField<TProperty> | JoinedOrderExpression,
    ): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        return this.addOrdering(selector, 'desc');
    }

    public skip(count: number): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        assertNonNegativeInteger(count, 'skip');
        return this.with({ offset: count });
    }

    public take(count: number): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        assertNonNegativeInteger(count, 'take');
        return this.with({ limit: count });
    }

    public ignoreQueryFilters(): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        return this.with({ ignoreQueryFilters: true });
    }

    public ignoreTenantScope(): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        return this.with({ ignoreTenantScope: true });
    }

    private addOrdering<TProperty>(
        selector: (
            sources: JoinedQueryProxy<TRoot, TJoined>,
        ) => QueryField<TProperty> | JoinedOrderExpression,
        defaultDirection: 'asc' | 'desc',
    ): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        const selected = selector(
            createJoinedQueryProxy<TRoot, TJoined>(this.joinAliases()),
        );
        const ordering = normalizeOrdering(
            selected, defaultDirection,
        ) as OrderExpression<TRoot>;
        return this.with({ orderings: [...this.model.orderings, ordering] });
    }
}
