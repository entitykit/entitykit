import type {
    ProjectionExpression,
    ProjectionSqlNode,
} from '../query/projection';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';
import {
    projectionValueField,
    type ProjectionValueField,
} from './projection-expression-metadata';

export type ProjectionFieldSql = (
    sourceAlias: string | undefined,
    propertyName: string,
) => string;

export type ProjectionFieldValue = (
    sourceAlias: string | undefined,
    propertyName: string,
    value: unknown,
) => unknown;

export function projectionColumnSql(
    dialect: SqlDialect,
    projection: ProjectionExpression,
    parameters: SqlParameterBag,
    fieldSql: ProjectionFieldSql,
    fieldValue: ProjectionFieldValue,
): string {
    const node: ProjectionSqlNode = projection.kind === 'computed'
        ? projection.expression
        : projection.kind === 'literal'
            ? { kind: 'literal', value: projection.value }
            : {
                kind: 'field',
                sourceAlias: projection.sourceAlias,
                propertyName: projection.propertyName,
            };
    return `${renderProjectionSqlNode(
        dialect,
        node,
        parameters,
        fieldSql,
        fieldValue,
    )} as ${dialect.quoteIdentifier(projection.alias)}`;
}

function renderProjectionSqlNode(
    dialect: SqlDialect,
    node: ProjectionSqlNode,
    parameters: SqlParameterBag,
    fieldSql: ProjectionFieldSql,
    fieldValue: ProjectionFieldValue,
    literalField?: ProjectionValueField,
): string {
    switch (node.kind) {
        case 'field':
            return fieldSql(node.sourceAlias, node.propertyName);
        case 'literal':
            return parameters.add(literalField
                ? fieldValue(
                    literalField.sourceAlias,
                    literalField.propertyName,
                    node.value,
                )
                : node.value);
        case 'binary':
            return `(${renderProjectionSqlNode(
                dialect, node.left, parameters, fieldSql, fieldValue,
            )} ${node.operator} ${renderProjectionSqlNode(
                dialect, node.right, parameters, fieldSql, fieldValue,
            )})`;
        case 'call':
            return renderCall(
                dialect,
                node,
                parameters,
                fieldSql,
                fieldValue,
            );
    }
}

function renderCall(
    dialect: SqlDialect,
    node: Extract<ProjectionSqlNode, { kind: 'call' }>,
    parameters: SqlParameterBag,
    fieldSql: ProjectionFieldSql,
    fieldValue: ProjectionFieldValue,
): string {
    const coalesceField = node.function === 'coalesce'
        ? projectionValueField(node.operands[0])
        : undefined;
    const operands = node.operands.map((operand, index) =>
        renderProjectionSqlNode(
            dialect,
            operand,
            parameters,
            fieldSql,
            fieldValue,
            index === 1 && operand.kind === 'literal'
                ? coalesceField
                : undefined,
        ));
    if (node.function === 'concat') {
        return dialect.stringConcatExpression?.(operands) ??
            `(${operands.join(' || ')})`;
    }
    if (node.function === 'length') {
        const operand = operands[0];
        if (!operand) {
            throw new Error('length requires one operand.');
        }
        return dialect.stringLengthExpression?.(operand) ??
            `length(${operand})`;
    }
    return `${node.function}(${operands.join(', ')})`;
}
