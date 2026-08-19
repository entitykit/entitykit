import type { EntityPropertyKey } from '../types';
import type { OrderExpression } from './expression/order-expression';
import type { QueryField, QueryProxy } from './query-field-types';
import type { PredicateExpression } from './predicate-types';

/** Entity type reached by a reference or collection navigation. */
export type NavigationElement<TNavigation> =
    NonNullable<TNavigation> extends ReadonlyArray<infer TElement>
        ? NonNullable<TElement>
        : NonNullable<TNavigation>;

/** Typed navigation choices supplied to `include()` and `thenInclude()`. */
export type IncludeProxy<TEntity extends object> = {
    readonly [K in EntityPropertyKey<TEntity>]:
    IncludeNavigationExpression<TEntity, TEntity[K]>;
};

/** Public filtered-include expression; EntityKit owns its compiled form. */
export interface IncludeNavigationExpression<
    TEntity extends object,
    TNavigation = unknown,
> {
    /** The navigation property. */ readonly navigationProperty: EntityPropertyKey<TEntity>;
    /** The navigation path. */ readonly navigationPath: readonly string[];
    /** Add a typed where predicate. */ where(selector: (
        entity: QueryProxy<NavigationElement<TNavigation>>,
    ) => PredicateExpression): this;
    /** Add order by to the query. */ orderBy<TProperty>(selector: (
        entity: QueryProxy<NavigationElement<TNavigation>>,
    ) => QueryField<TProperty> | OrderExpression<NavigationElement<TNavigation>>): this;
    /** Add order by descending to the query. */ orderByDescending<TProperty>(selector: (
        entity: QueryProxy<NavigationElement<TNavigation>>,
    ) => QueryField<TProperty> | OrderExpression<NavigationElement<TNavigation>>): this;
    /** Apply the skip row count. */ skip(count: number): this;
    /** Apply the take row count. */ take(count: number): this;
}
