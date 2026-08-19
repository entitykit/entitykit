import type { PredicateExpression } from './predicate-types';
import type { QueryProxy } from './query-field-types';
import { createQueryProxy } from './query-proxy';
import type { Queryable } from './queryable';
import {
    assertPredicateExpression,
} from './queryable-helpers';
import { QueryableState } from './queryable-state';

export abstract class QueryableFiltering<
    TEntity extends object,
> extends QueryableState<TEntity> {
    public where(
        selector: (entity: QueryProxy<TEntity>) => PredicateExpression,
    ): Queryable<TEntity> {
        const predicate = selector(createQueryProxy<TEntity>());
        assertPredicateExpression(predicate, 'where selectors');
        const combined = this.model.predicate
            ? this.model.predicate.and(predicate)
            : predicate;
        return this.with({ predicate: combined });
    }

    public whereIf(
        condition: boolean,
        selector: (entity: QueryProxy<TEntity>) => PredicateExpression,
    ): Queryable<TEntity> {
        return condition ? this.where(selector) : this as unknown as Queryable<TEntity>;
    }

    public ignoreQueryFilters(): Queryable<TEntity> {
        return this.with({ ignoreQueryFilters: true });
    }

    public ignoreTenantScope(): Queryable<TEntity> {
        return this.with({ ignoreTenantScope: true });
    }

    /**
     * Materialize an entity graph without adding it to this context's tracker.
     *
     * A query-local identity map still ensures repeated rows and includes reuse
     * one object instance for each primary key.
     */
    public asNoTracking(): Queryable<TEntity> {
        return this.with({ trackingBehavior: 'noTracking' });
    }
}
