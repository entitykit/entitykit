/**
 * Compatibility exports for the original joined-query helper module.
 *
 * Production modules import their focused collaborators directly.
 */
export {
    normalizeAggregateOrdering,
    normalizeOrdering,
} from './joined-query-ordering';
export type { JoinedOrderExpression } from './joined-query-ordering';
export {
    snapshotJoinedQueryModel as cloneJoinedQueryModel,
} from './query-model-snapshot';
export {
    createJoinedProjectionProxy,
    createJoinedQueryProxy,
} from './joined-query-proxy';
export type {
    JoinedProjectionProxy,
    JoinedQueryProxy,
    JoinTarget,
    NullableProjectionEntity,
} from './joined-query-proxy';
export {
    assertHavingPredicateExpression,
    assertJoinPredicate,
    assertNonNegativeInteger,
    assertPredicateExpression,
    validateJoinAlias,
} from './joined-query-validation';
