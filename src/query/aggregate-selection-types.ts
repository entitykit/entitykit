import type { QueryField } from './query-field-types';
import type {
    AggregateField,
    DateBucketGroupKey,
    GroupKeyField,
} from './aggregate-field-contracts';

/** Public type representing aggregate selection. */ export type AggregateSelection =
    Record<string, AggregateField>;

/** Public type representing group key selection. */ export type GroupKeySelection =
    Record<string, QueryField<unknown> | DateBucketGroupKey<unknown>>;

/** Public type representing grouped aggregate selection. */ export type GroupedAggregateSelection =
    Record<string, AggregateField | GroupKeyField>;

/** Result produced by aggregate. */ export type AggregateResult<TSelection extends AggregateSelection> = {
    readonly [K in keyof TSelection]:
    TSelection[K] extends AggregateField<infer TValue> ? TValue : never;
};

/** Result produced by group key. */ export type GroupKeyResult<TSelection extends GroupKeySelection> = {
    readonly [K in keyof TSelection]:
    TSelection[K] extends QueryField<infer TValue> ? TValue :
        TSelection[K] extends DateBucketGroupKey<infer TBucket> ? TBucket :
            never;
};

/** Result produced by grouped aggregate. */ export type GroupedAggregateResult<
    TSelection extends GroupedAggregateSelection,
> = {
    readonly [K in keyof TSelection]:
    TSelection[K] extends AggregateField<infer TAggregate> ? TAggregate :
        TSelection[K] extends GroupKeyField<infer TKey> ? TKey :
            never;
};
