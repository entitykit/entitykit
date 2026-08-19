import type { EntityPropertyKey } from '../../types';
import type { OrderExpression } from './order-expression';
import type { PredicateExpression } from './predicate-expression';

export interface QueryFieldOperand<TProperty = unknown> {
    readonly propertyName: string;
    readonly sourceAlias?: string;
    readonly __type?: TProperty;
}

export type QueryField<TProperty> =
  QueryFieldOperand<TProperty> &
  EqualityFieldOperators<TProperty> &
  NullFieldOperators &
  SortFieldOperators &
  StringFieldOperators<TProperty> &
  ComparableFieldOperators<TProperty>;

export type QueryProxy<TEntity extends object> = {
    readonly [K in EntityPropertyKey<TEntity>]:
    QueryField<TEntity[K]> &
    (NonNullable<TEntity[K]> extends object
        ? QueryProxy<NonNullable<TEntity[K]>>
        : unknown);
};

interface EqualityFieldOperators<TProperty> {
    eq(value: TProperty | QueryFieldOperand<TProperty>): PredicateExpression;
    ne(value: TProperty | QueryFieldOperand<TProperty>): PredicateExpression;
    in(values: readonly TProperty[]): PredicateExpression;
}

interface NullFieldOperators {
    isNull(): PredicateExpression;
    isNotNull(): PredicateExpression;
}

interface SortFieldOperators {
    asc(): OrderExpression;
    desc(): OrderExpression;
}

type StringFieldOperators<TProperty> = NonNullable<TProperty> extends string
    ? {
        like(value: string): PredicateExpression;
        contains(value: string): PredicateExpression;
        startsWith(value: string): PredicateExpression;
        endsWith(value: string): PredicateExpression;
    }
    : unknown;

type ComparableFieldOperators<TProperty> = NonNullable<TProperty> extends number | string | Date
    ? {
        gt(value: NonNullable<TProperty>): PredicateExpression;
        gte(value: NonNullable<TProperty>): PredicateExpression;
        lt(value: NonNullable<TProperty>): PredicateExpression;
        lte(value: NonNullable<TProperty>): PredicateExpression;
    }
    : unknown;
