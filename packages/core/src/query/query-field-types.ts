import type { EntityPropertyKey } from '../types';
import type { OrderExpression } from './expression/order-expression';
import type { PredicateExpression } from './predicate-types';

/** Provider-neutral reference to a mapped field used in query expressions. */
export interface QueryFieldOperand<TProperty = unknown> {
    /** The property name. */ readonly propertyName: string;
    /** The source alias. */ readonly sourceAlias?: string;
    /** The type. */ readonly __type?: TProperty;
}

/** Operators available for a mapped field in a query selector. */
export type QueryField<TProperty> = QueryFieldOperand<TProperty> & {
    /** Perform the eq operation. */ eq(value: TProperty | QueryFieldOperand<TProperty>): PredicateExpression;
    /** Perform the ne operation. */ ne(value: TProperty | QueryFieldOperand<TProperty>): PredicateExpression;
    /** Perform the in operation. */ in(values: readonly TProperty[]): PredicateExpression;
    /** Configure null and return this builder. */ isNull(): PredicateExpression;
    /** Configure not null and return this builder. */ isNotNull(): PredicateExpression;
    /** Perform the asc operation. */ asc(): OrderExpression;
    /** Perform the desc operation. */ desc(): OrderExpression;
} & (NonNullable<TProperty> extends string ? {
    /** Perform the like operation. */ like(value: string): PredicateExpression;
    /** Perform the contains operation. */ contains(value: string): PredicateExpression;
    /** Perform the starts with operation. */ startsWith(value: string): PredicateExpression;
    /** Perform the ends with operation. */ endsWith(value: string): PredicateExpression;
} : unknown) & (NonNullable<TProperty> extends number | string | Date ? {
    /** Perform the gt operation. */ gt(value: NonNullable<TProperty>): PredicateExpression;
    /** Perform the gte operation. */ gte(value: NonNullable<TProperty>): PredicateExpression;
    /** Perform the lt operation. */ lt(value: NonNullable<TProperty>): PredicateExpression;
    /** Perform the lte operation. */ lte(value: NonNullable<TProperty>): PredicateExpression;
} : unknown);

/** Typed mapped fields supplied to query selectors. */
export type QueryProxy<TEntity extends object> = {
    readonly [K in EntityPropertyKey<TEntity>]:
    QueryField<TEntity[K]> &
    (NonNullable<TEntity[K]> extends object
        ? QueryProxy<NonNullable<TEntity[K]>>
        : unknown);
};
