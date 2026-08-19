/**
 * Public surface for aggregate + grouped queries.
 *
 * The implementation has been decomposed into single-responsibility modules so
 * no file grows unwieldy; this module exists purely to keep the historical
 * `query/Aggregate` import path stable. It re-exports every symbol unchanged:
 *
 * - `AggregateExpressionTypes` — serializable expression / HAVING AST types.
 * - `AggregateFieldTypes`       — phantom-typed field / selection / proxy / result types.
 * - `AggregatePredicate`        — the `HavingPredicateExpression` combinator class.
 * - `AggregateProxy`            — factories that build the entity-facing proxies.
 * - `AggregateExpressions`      — factories that compile selections into wire expressions.
 *
 * (The shared `AggregateHaving` operator builders and `AggregateSymbols` brands
 * are internal and intentionally not re-exported.)
 */

export type {
    AggregateFunction,
    DateBucketPrecision,
    AggregateExpression,
    GroupKeyExpression,
    PropertyGroupKeyExpression,
    DateBucketGroupKeyExpression,
    GroupKeyProjectionExpression,
    PropertyGroupKeyProjectionExpression,
    DateBucketGroupKeyProjectionExpression,
    AggregateOrderExpression,
    HavingOperandExpression,
    HavingAggregateOperandExpression,
    HavingGroupKeyOperandExpression,
    HavingPredicateNode,
    HavingBinaryPredicateNode,
    HavingNullPredicateNode,
    HavingLogicalPredicateNode,
    HavingNotPredicateNode,
} from './aggregate-expression-types';

export type {
    DateBucketGroupKey,
    AggregateField,
    GroupKeyField,
    NumericPropertyKey,
    ComparablePropertyKey,
    AggregateSelection,
    GroupKeySelection,
    GroupedAggregateSelection,
    AggregateResult,
    GroupKeyResult,
    GroupedAggregateResult,
    GroupKeyProxy,
    AggregateProxy,
    GroupedAggregateProxy,
} from './aggregate-field-types';

export { HavingPredicateExpression } from './aggregate-predicate';

export { createAggregateProxy, createGroupedAggregateProxy } from './aggregate-proxy';

export {
    createGroupKeyExpressions,
    createAggregateExpressions,
    createGroupedAggregateExpressions,
} from './aggregate-selection-expressions';

export {
    isAggregateField,
    isGroupKeyField,
    createDateBucketGroupKey,
    isDateBucketGroupKey,
} from './aggregate-field-guards';
