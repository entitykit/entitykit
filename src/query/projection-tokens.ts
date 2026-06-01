import type { EntityPropertyKey } from '../types';
import {
    projectionFieldSymbol,
    projectionLiteralSymbol,
    sqlExpressionSymbol,
    type ProjectionField,
    type ProjectionLiteral,
    type ProjectionMaterialization,
    type ProjectionProxy,
    type ProjectionSqlNode,
    type RuntimeSqlExpression,
} from './projection-types';

export function createProjectionProxy<TEntity extends object>(
    sourceAlias?: string,
): ProjectionProxy<TEntity> {
    return new Proxy({}, {
        get(_target, property): ProjectionField {
            if (typeof property !== 'string') {
                throw new Error(
                    'Projection selectors must access string properties.',
                );
            }
            return createProjectionField([property], sourceAlias);
        },
    }) as ProjectionProxy<TEntity>;
}

export function isProjectionField(value: unknown): value is ProjectionField {
    return hasToken(value, projectionFieldSymbol);
}

export function isProjectionLiteral(value: unknown): value is ProjectionLiteral {
    return hasToken(value, projectionLiteralSymbol);
}

export function isSqlExpression(
    value: unknown,
): value is RuntimeSqlExpression {
    return hasToken(value, sqlExpressionSymbol);
}

export function toProjectionSqlNode(value: unknown): ProjectionSqlNode {
    if (isProjectionField(value)) {
        return {
            kind: 'field',
            sourceAlias: value.sourceAlias,
            propertyName: value.propertyName,
        };
    }
    if (isProjectionLiteral(value)) {
        return { kind: 'literal', value: value.value };
    }
    if (isSqlExpression(value)) {
        return value.expression;
    }
    throw new TypeError(
        'SQL projection expressions require mapped fields, projection literals, or other SQL expressions.',
    );
}

export function projectionMaterialization(
    value: unknown,
): ProjectionMaterialization {
    if (isProjectionField(value)) {
        return {
            kind: 'field',
            sourceAlias: value.sourceAlias,
            propertyName: value.propertyName,
        };
    }
    if (isSqlExpression(value)) {
        return value.materialization;
    }
    return { kind: 'raw' };
}

export function projectionField<TEntity extends object>(
    propertyName: EntityPropertyKey<TEntity>,
    sourceAlias?: string,
): ProjectionField {
    return {
        [projectionFieldSymbol]: true,
        propertyName,
        sourceAlias,
    };
}

function hasToken(value: unknown, token: symbol): boolean {
    return Boolean(
        value &&
        typeof value === 'object' &&
        (value as Record<symbol, unknown>)[token] === true,
    );
}

function createProjectionField(
    path: readonly string[],
    sourceAlias?: string,
): ProjectionField {
    const field: ProjectionField = {
        [projectionFieldSymbol]: true,
        sourceAlias,
        propertyName: path.join('.'),
    };
    return new Proxy(field, {
        get(target, property, receiver): unknown {
            if (typeof property !== 'string' || property in target) {
                return Reflect.get(target, property, receiver);
            }
            return createProjectionField([...path, property], sourceAlias);
        },
    });
}
