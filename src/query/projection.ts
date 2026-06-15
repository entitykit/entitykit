/**
 * Public projection facade. Definitions, token construction, SQL-expression
 * building, and recursive selection flattening stay in separate modules while
 * callers keep the historical `query/projection` import seam.
 */
export {
    createProjectionBuilder,
} from './projection-builder';
export {
    createProjectionExpression,
} from './projection-selection';
export {
    createProjectionProxy,
    isProjectionField,
    isProjectionLiteral,
    isSqlExpression,
} from './projection-tokens';
export type {
    ProjectionBuilder,
    ProjectionComputedExpression,
    ProjectionExpression,
    ProjectionField,
    ProjectionFieldExpression,
    ProjectionLiteral,
    ProjectionLiteralExpression,
    ProjectionLiteralValue,
    ProjectionProxy,
    ProjectionResult,
    ProjectionSelection,
    ProjectionSqlNode,
    ProjectionSqlOperand,
    SqlExpression,
} from './projection-types';
