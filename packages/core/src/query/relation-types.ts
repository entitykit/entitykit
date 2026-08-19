import type { EntityPropertyKey } from '../types';
import type { NavigationElement } from './include-types';
import type { PredicateExpression } from './predicate-types';
import type { QueryProxy } from './query-field-types';

/** Typed navigation choices supplied to relation-existence filters. */
export type RelationNavigationProxy<TEntity extends object> = {
    readonly [K in EntityPropertyKey<TEntity>]:
    RelationNavigationExpression<TEntity, TEntity[K]>;
};

/** Public navigation selection for `whereHas()` and `whereDoesNotHave()`. */
export interface RelationNavigationExpression<
    TEntity extends object,
    TNavigation = unknown,
> {
    /** The navigation property. */ readonly navigationProperty: EntityPropertyKey<TEntity>;
    /** @internal Carries navigation inference; not part of the runtime shape. */
    readonly __navigationType?: TNavigation;
}

/** Optional related-row filter used by relation-existence queries. */
export type RelationPredicateSelector<TNavigation> = (
    entity: QueryProxy<NavigationElement<TNavigation>>,
) => PredicateExpression;
