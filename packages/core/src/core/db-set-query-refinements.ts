import type { OrderExpression } from '../query/expression/order-expression';
import type { PredicateExpression } from '../query/predicate-types';
import type { QueryField, QueryProxy } from '../query/query-field-types';
import type { Queryable } from '../query/queryable';
import type {
    RelationNavigationExpression,
    RelationNavigationProxy,
    RelationPredicateSelector,
} from '../query/relation-types';
import { DbSetQueryTerminals } from './db-set-query-terminals';

/** Same-shape query refinements exposed directly by every `DbSet`. */
export abstract class DbSetQueryRefinements<
    TEntity extends object,
> extends DbSetQueryTerminals<TEntity> {
    public where(
        selector: (entity: QueryProxy<TEntity>) => PredicateExpression,
    ): Queryable<TEntity> {
        return this.query().where(selector);
    }

    public whereIf(
        condition: boolean,
        selector: (entity: QueryProxy<TEntity>) => PredicateExpression,
    ): Queryable<TEntity> {
        return this.query().whereIf(condition, selector);
    }

    public whereHas<TNavigation>(
        selector: (
            entity: RelationNavigationProxy<TEntity>,
        ) => RelationNavigationExpression<TEntity, TNavigation>,
        predicateSelector?: RelationPredicateSelector<TNavigation>,
    ): Queryable<TEntity> {
        return this.query().whereHas(selector, predicateSelector);
    }

    public whereDoesNotHave<TNavigation>(
        selector: (
            entity: RelationNavigationProxy<TEntity>,
        ) => RelationNavigationExpression<TEntity, TNavigation>,
        predicateSelector?: RelationPredicateSelector<TNavigation>,
    ): Queryable<TEntity> {
        return this.query().whereDoesNotHave(selector, predicateSelector);
    }

    public orderBy<TProperty>(
        selector: (
            entity: QueryProxy<TEntity>,
        ) => QueryField<TProperty> | OrderExpression<TEntity>,
    ): Queryable<TEntity> {
        return this.query().orderBy(selector);
    }

    public orderByDescending<TProperty>(
        selector: (
            entity: QueryProxy<TEntity>,
        ) => QueryField<TProperty> | OrderExpression<TEntity>,
    ): Queryable<TEntity> {
        return this.query().orderByDescending(selector);
    }

    public skip(count: number): Queryable<TEntity> {
        return this.query().skip(count);
    }

    public take(count: number): Queryable<TEntity> {
        return this.query().take(count);
    }

    public ignoreQueryFilters(): Queryable<TEntity> {
        return this.query().ignoreQueryFilters();
    }

    /** Query across every tenant. See `Queryable.ignoreTenantScope`. */
    public ignoreTenantScope(): Queryable<TEntity> {
        return this.query().ignoreTenantScope();
    }

    /** Start an entity query that does not populate this context's tracker. */
    public asNoTracking(): Queryable<TEntity> {
        return this.query().asNoTracking();
    }
}
