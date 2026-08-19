import {
    projectionLiteralSymbol,
    sqlExpressionSymbol,
    type ProjectionBuilder,
    type ProjectionLiteral,
    type ProjectionLiteralValue,
    type ProjectionMaterialization,
    type ProjectionSqlNode,
    type RuntimeSqlExpression,
    type SqlExpression,
} from './projection-types';
import {
    isProjectionLiteral,
    projectionMaterialization,
    toProjectionSqlNode,
} from './projection-tokens';

export function createProjectionBuilder(): ProjectionBuilder {
    return {
        literal<TValue extends ProjectionLiteralValue>(
            value: TValue,
        ): ProjectionLiteral<TValue> {
            return { [projectionLiteralSymbol]: true, value };
        },
        lower: value => call('lower', [value], { kind: 'raw' }),
        upper: value => call('upper', [value], { kind: 'raw' }),
        trim: value => call('trim', [value], { kind: 'raw' }),
        length: value => call('length', [value], { kind: 'number' }),
        concat: (...values) => {
            if (values.length < 2) {
                throw new Error('concat requires at least two operands.');
            }
            return call('concat', values, { kind: 'raw' });
        },
        coalesce: (value, fallback) => call(
            'coalesce',
            [value, fallback],
            isProjectionLiteral(value) && value.value === null
                ? projectionMaterialization(fallback)
                : projectionMaterialization(value),
        ),
        add: (left, right) => binary('+', left, right),
        subtract: (left, right) => binary('-', left, right),
        multiply: (left, right) => binary('*', left, right),
        modulo: (left, right) => binary('%', left, right),
    };
}

function call<TResult>(
    name: Extract<ProjectionSqlNode, { kind: 'call' }>['function'],
    values: readonly unknown[],
    materialization: ProjectionMaterialization,
): SqlExpression<TResult> {
    return expression({
        kind: 'call',
        function: name,
        operands: values.map(toProjectionSqlNode),
    }, materialization);
}

function binary<TResult>(
    operator: Extract<ProjectionSqlNode, { kind: 'binary' }>['operator'],
    left: unknown,
    right: unknown,
): SqlExpression<TResult> {
    return expression({
        kind: 'binary',
        operator,
        left: toProjectionSqlNode(left),
        right: toProjectionSqlNode(right),
    }, { kind: 'number' });
}

function expression<TResult>(
    node: ProjectionSqlNode,
    materialization: ProjectionMaterialization,
): RuntimeSqlExpression<TResult> {
    return {
        [sqlExpressionSymbol]: true,
        expression: node,
        materialization,
    };
}
