import type { OrderExpression } from './expression/order-expression';
import type { QueryField, QueryProxy } from './query-field-types';
import { createQueryProxy } from './query-proxy';
import type { Queryable } from './queryable';
import {
    assertNonNegativeInteger,
    normalizeOrdering,
} from './queryable-helpers';
import { QueryableRelations } from './queryable-relations';

export abstract class QueryableOrdering<
    TEntity extends object,
> extends QueryableRelations<TEntity> {
    public orderBy<TProperty>(
        selector: (
            entity: QueryProxy<TEntity>,
        ) => QueryField<TProperty> | OrderExpression<TEntity>,
    ): Queryable<TEntity> {
        return this.addOrdering(selector, 'asc');
    }

    public orderByDescending<TProperty>(
        selector: (
            entity: QueryProxy<TEntity>,
        ) => QueryField<TProperty> | OrderExpression<TEntity>,
    ): Queryable<TEntity> {
        return this.addOrdering(selector, 'desc');
    }

    public skip(count: number): Queryable<TEntity> {
        assertNonNegativeInteger(count, 'skip');
        return this.with({ offset: count });
    }

    public take(count: number): Queryable<TEntity> {
        assertNonNegativeInteger(count, 'take');
        return this.with({ limit: count });
    }

    private addOrdering<TProperty>(
        selector: (
            entity: QueryProxy<TEntity>,
        ) => QueryField<TProperty> | OrderExpression<TEntity>,
        defaultDirection: 'asc' | 'desc',
    ): Queryable<TEntity> {
        const selected = selector(createQueryProxy<TEntity>());
        const ordering = normalizeOrdering(selected, defaultDirection);
        return this.with({
            orderings: [...this.model.orderings, ordering],
        });
    }
}
