/**
 * Compatibility exports for the original aggregate field type module.
 *
 * Runtime modules import the focused declaration owners directly.
 */
export type {
    AggregateField,
    ComparablePropertyKey,
    DateBucketGroupKey,
    GroupKeyField,
    HavingFieldOperators,
    NumericPropertyKey,
} from './aggregate-field-contracts';
export type {
    AggregateProxy,
    GroupedAggregateProxy,
    GroupKeyProxy,
} from './aggregate-proxy-types';
export type {
    AggregateResult,
    AggregateSelection,
    GroupedAggregateResult,
    GroupedAggregateSelection,
    GroupKeyResult,
    GroupKeySelection,
} from './aggregate-selection-types';
