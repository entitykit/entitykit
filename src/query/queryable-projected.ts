import type { OrderExpression } from './expression/order-expression';
import type { PredicateExpression } from './predicate-types';
import type { QueryField, QueryProxy } from './query-field-types';
import { createQueryProxy } from './query-proxy';
import { cloneQueryModel, type QueryModel } from './query-model';
import { snapshotQueryModel } from './query-model-snapshot';
import { ProjectedQueryTerminals } from './projected-query-terminals';
import {
    assertNonNegativeInteger,
    assertPredicateExpression,
    normalizeOrdering,
} from './queryable-helpers';

/**
 * Builder produced by `Queryable.select(...)`.
 *
 * Split out of `Queryable.ts` because a projection is a distinct query shape:
 * it returns plain projected rows rather than tracked entities. Entity-proxy
 * refinements stay here, shared projected terminal execution is inherited, and
 * entity-only methods (`include`, joins, relation existence, bulk writes) are
 * deliberately absent.
 */
export class ProjectedQueryable<
    TEntity extends object,
    TProjection extends Record<string, unknown>,
> extends ProjectedQueryTerminals<TEntity, TProjection> {

    public where(selector: (entity: QueryProxy<TEntity>) => PredicateExpression): ProjectedQueryable<TEntity, TProjection> {
        const predicate = selector(createQueryProxy<TEntity>());
        assertPredicateExpression(predicate, 'where selectors');
        const combined = this.model.predicate ? this.model.predicate.and(predicate) : predicate;
        return this.with({ predicate: combined });
    }

    public whereIf(condition: boolean, selector: (entity: QueryProxy<TEntity>) => PredicateExpression): ProjectedQueryable<TEntity, TProjection> {
        return condition ? this.where(selector) : this;
    }

    public orderBy<TProperty>(
        selector: (entity: QueryProxy<TEntity>) => QueryField<TProperty> | OrderExpression<TEntity>,
    ): ProjectedQueryable<TEntity, TProjection> {
        return this.addOrdering(selector, 'asc');
    }

    public orderByDescending<TProperty>(
        selector: (entity: QueryProxy<TEntity>) => QueryField<TProperty> | OrderExpression<TEntity>,
    ): ProjectedQueryable<TEntity, TProjection> {
        return this.addOrdering(selector, 'desc');
    }

    public skip(count: number): ProjectedQueryable<TEntity, TProjection> {
        assertNonNegativeInteger(count, 'skip');
        return this.with({ offset: count });
    }

    public take(count: number): ProjectedQueryable<TEntity, TProjection> {
        assertNonNegativeInteger(count, 'take');
        return this.with({ limit: count });
    }

    public ignoreQueryFilters(): ProjectedQueryable<TEntity, TProjection> {
        return this.with({ ignoreQueryFilters: true });
    }

    /** Project across every tenant. See `Queryable.ignoreTenantScope`. */
    public ignoreTenantScope(): ProjectedQueryable<TEntity, TProjection> {
        return this.with({ ignoreTenantScope: true });
    }

    public override toQueryModel(): QueryModel<TEntity> {
        return snapshotQueryModel(this.model);
    }

    protected override with(
        changes: Partial<Omit<QueryModel<TEntity>, 'entityType'>>,
    ): ProjectedQueryable<TEntity, TProjection> {
        return new ProjectedQueryable(this.metadata, this.executor, cloneQueryModel(this.model, changes));
    }

    private addOrdering<TProperty>(
        selector: (entity: QueryProxy<TEntity>) => QueryField<TProperty> | OrderExpression<TEntity>,
        defaultDirection: 'asc' | 'desc',
    ): ProjectedQueryable<TEntity, TProjection> {
        const selected = selector(createQueryProxy<TEntity>());
        const ordering = normalizeOrdering(selected, defaultDirection);
        return this.with({ orderings: [...this.model.orderings, ordering] });
    }
}
