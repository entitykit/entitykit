import type { QueryField, QueryProxy } from './query-field-types';
import type {
    AggregateField,
    GroupKeyField,
} from './aggregate-field-contracts';

/** Public type representing group key proxy. */ export type GroupKeyProxy<
    TKeySelection extends Record<string, unknown>,
> = {
    readonly [K in keyof TKeySelection]: GroupKeyField<TKeySelection[K]>;
};

/** Public contract for aggregate proxy. */ export interface AggregateProxy<
    TEntity extends object,
    TSelectorProxy = QueryProxy<TEntity>,
> {
    /** Return the number of matching rows. */ count(): AggregateField<number>;
    /** Return the number of matching rows. */ count<TProperty>(
        selector: (entity: TSelectorProxy) => QueryField<TProperty>
    ): AggregateField<number>;
    /**
   * Nullable columns are accepted because SQL ignores nulls when aggregating.
   *
   * Exact numeric strings are deliberately not accepted: summing them as
   * JavaScript numbers would discard the precision that mapping protects.
   */
    sum(
        selector: (entity: TSelectorProxy) => QueryField<number | null>
    ): AggregateField<number | null>;
    /** Perform the avg operation. */ avg(
        selector: (entity: TSelectorProxy) => QueryField<number | null>
    ): AggregateField<number | null>;
    /** Nullable columns are accepted because SQL ignores nulls. */
    min<TProperty extends number | string | Date>(
        selector: (entity: TSelectorProxy) => QueryField<TProperty | null>
    ): AggregateField<TProperty | null>;
    /** Perform the max operation. */ max<TProperty extends number | string | Date>(
        selector: (entity: TSelectorProxy) => QueryField<TProperty | null>
    ): AggregateField<TProperty | null>;
}

/** Public type representing grouped aggregate proxy. */ export type GroupedAggregateProxy<
    TEntity extends object,
    TKeySelection extends Record<string, unknown>,
    TSelectorProxy = QueryProxy<TEntity>,
> = AggregateProxy<TEntity, TSelectorProxy> & {
    /** The key. */ readonly key: GroupKeyProxy<TKeySelection>;
};
