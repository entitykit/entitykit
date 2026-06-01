import type {
    aggregateFieldSymbol,
    dateBucketGroupKeySymbol,
    groupKeyFieldSymbol,
} from './aggregate-symbols';
import type {
    AggregateFunction,
    DateBucketPrecision,
} from './aggregate-expression-types';
import type { AggregateOrderExpression } from './aggregate-order-types';
import type { HavingPredicateExpression } from './predicate-types';

/** Public contract for date bucket group key. */ export interface DateBucketGroupKey<TResult = Date> {
    /** The group key field symbol. */ readonly [dateBucketGroupKeySymbol]: true;
    /** Name of the configured database provider. */ readonly provider: 'postgres';
    /** The precision. */ readonly precision: DateBucketPrecision;
    /** The time zone. */ readonly timeZone: string;
    /** The source alias. */ readonly sourceAlias?: string;
    /** The property name. */ readonly propertyName: string;
    /** The type. */ readonly __type?: TResult;
}

/** Public type representing aggregate field. */ export type AggregateField<TResult = unknown> = {
    /** The group key field symbol. */ readonly [aggregateFieldSymbol]: true;
    /** The function. */ readonly function: AggregateFunction;
    /** The source alias. */ readonly sourceAlias?: string;
    /** The property name. */ readonly propertyName?: string;
    /** The type. */ readonly __type?: TResult;
} & {
    /** Perform the eq operation. */ eq(value: TResult): HavingPredicateExpression;
    /** Perform the ne operation. */ ne(value: TResult): HavingPredicateExpression;
    /** Perform the in operation. */ in(values: readonly TResult[]): HavingPredicateExpression;
    /** Configure null and return this builder. */ isNull(): HavingPredicateExpression;
    /** Configure not null and return this builder. */ isNotNull(): HavingPredicateExpression;
    /** Perform the asc operation. */ asc(): AggregateOrderExpression;
    /** Perform the desc operation. */ desc(): AggregateOrderExpression;
} & (NonNullable<TResult> extends string ? {
    /** Perform the like operation. */ like(value: string): HavingPredicateExpression;
    /** Perform the contains operation. */ contains(value: string): HavingPredicateExpression;
    /** Perform the starts with operation. */ startsWith(value: string): HavingPredicateExpression;
    /** Perform the ends with operation. */ endsWith(value: string): HavingPredicateExpression;
} : unknown) & (NonNullable<TResult> extends number | Date ? {
    /** Perform the gt operation. */ gt(value: NonNullable<TResult>): HavingPredicateExpression;
    /** Perform the gte operation. */ gte(value: NonNullable<TResult>): HavingPredicateExpression;
    /** Perform the lt operation. */ lt(value: NonNullable<TResult>): HavingPredicateExpression;
    /** Perform the lte operation. */ lte(value: NonNullable<TResult>): HavingPredicateExpression;
} : unknown);

/** Public type representing group key field. */ export type GroupKeyField<TResult = unknown> = {
    /** The group key field symbol. */ readonly [groupKeyFieldSymbol]: true;
    /** The key alias. */ readonly keyAlias: string;
    /** The expression kind. */ readonly expressionKind: 'property' | 'dateBucket';
    /** Name of the configured database provider. */ readonly provider?: 'postgres';
    /** The precision. */ readonly precision?: DateBucketPrecision;
    /** The time zone. */ readonly timeZone?: string;
    /** The source alias. */ readonly sourceAlias?: string;
    /** The property name. */ readonly propertyName: string;
    /** The type. */ readonly __type?: TResult;
} & {
    /** Perform the eq operation. */ eq(value: TResult): HavingPredicateExpression;
    /** Perform the ne operation. */ ne(value: TResult): HavingPredicateExpression;
    /** Perform the in operation. */ in(values: readonly TResult[]): HavingPredicateExpression;
    /** Configure null and return this builder. */ isNull(): HavingPredicateExpression;
    /** Configure not null and return this builder. */ isNotNull(): HavingPredicateExpression;
    /** Perform the asc operation. */ asc(): AggregateOrderExpression;
    /** Perform the desc operation. */ desc(): AggregateOrderExpression;
} & (NonNullable<TResult> extends string ? {
    /** Perform the like operation. */ like(value: string): HavingPredicateExpression;
    /** Perform the contains operation. */ contains(value: string): HavingPredicateExpression;
    /** Perform the starts with operation. */ startsWith(value: string): HavingPredicateExpression;
    /** Perform the ends with operation. */ endsWith(value: string): HavingPredicateExpression;
} : unknown) & (NonNullable<TResult> extends number | Date ? {
    /** Perform the gt operation. */ gt(value: NonNullable<TResult>): HavingPredicateExpression;
    /** Perform the gte operation. */ gte(value: NonNullable<TResult>): HavingPredicateExpression;
    /** Perform the lt operation. */ lt(value: NonNullable<TResult>): HavingPredicateExpression;
    /** Perform the lte operation. */ lte(value: NonNullable<TResult>): HavingPredicateExpression;
} : unknown);

export type HavingFieldOperators<TResult> =
  HavingEqualityOperators<TResult> &
  HavingNullOperators &
  HavingSortOperators &
  HavingStringOperators<TResult> &
  HavingComparableOperators<TResult>;

interface HavingEqualityOperators<TResult> {
    /** Perform the eq operation. */ eq(value: TResult): HavingPredicateExpression;
    /** Perform the ne operation. */ ne(value: TResult): HavingPredicateExpression;
    /** Perform the in operation. */ in(values: readonly TResult[]): HavingPredicateExpression;
}

interface HavingNullOperators {
    /** Configure null and return this builder. */ isNull(): HavingPredicateExpression;
    /** Configure not null and return this builder. */ isNotNull(): HavingPredicateExpression;
}

interface HavingSortOperators {
    /** Perform the asc operation. */ asc(): AggregateOrderExpression;
    /** Perform the desc operation. */ desc(): AggregateOrderExpression;
}

type HavingStringOperators<TResult> =
    NonNullable<TResult> extends string
        ? {
            /** Perform the like operation. */ like(value: string): HavingPredicateExpression;
            /** Perform the contains operation. */ contains(value: string): HavingPredicateExpression;
            /** Perform the starts with operation. */ startsWith(value: string): HavingPredicateExpression;
            /** Perform the ends with operation. */ endsWith(value: string): HavingPredicateExpression;
        }
        : unknown;

type HavingComparableOperators<TResult> =
    NonNullable<TResult> extends number | Date
        ? {
            /** Perform the gt operation. */ gt(value: NonNullable<TResult>): HavingPredicateExpression;
            /** Perform the gte operation. */ gte(value: NonNullable<TResult>): HavingPredicateExpression;
            /** Perform the lt operation. */ lt(value: NonNullable<TResult>): HavingPredicateExpression;
            /** Perform the lte operation. */ lte(value: NonNullable<TResult>): HavingPredicateExpression;
        }
        : unknown;

/** Public type representing numeric property key. */ export type NumericPropertyKey<TEntity extends object> = {
    [K in keyof TEntity]-?:
    NonNullable<TEntity[K]> extends number ? K : never;
}[keyof TEntity] & string;

/** Public type representing comparable property key. */ export type ComparablePropertyKey<TEntity extends object> = {
    [K in keyof TEntity]-?:
    NonNullable<TEntity[K]> extends number | string | Date ? K : never;
}[keyof TEntity] & string;
