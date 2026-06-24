import type {
    BinaryOperator,
    PredicateNode,
} from '../../query/expression/predicate-node';
import {
    isSqlNull,
    readInPredicateValues,
} from '../predicate-null-semantics';
import { assertNever } from '../select-sql-helpers';

export function predicateShape(node: PredicateNode): unknown {
    switch (node.kind) {
        case 'binary':
            return {
                kind: node.kind,
                operator: node.operator,
                sourceAlias: node.sourceAlias,
                propertyName: node.propertyName,
                valueShape: predicateValueShape(node.operator, node.value),
            };
        case 'fieldComparison':
            return {
                kind: node.kind,
                operator: node.operator,
                left: node.left,
                right: node.right,
            };
        case 'null':
            return {
                kind: node.kind,
                operator: node.operator,
                sourceAlias: node.sourceAlias,
                propertyName: node.propertyName,
            };
        case 'logical':
            return {
                kind: node.kind,
                operator: node.operator,
                left: predicateShape(node.left),
                right: predicateShape(node.right),
            };
        case 'not':
            return {
                kind: node.kind,
                predicate: predicateShape(node.predicate),
            };
        default:
            return assertNever(node);
    }
}

export function predicateValueShape(
    operator: BinaryOperator,
    value: unknown,
): unknown {
    if ((operator === 'eq' || operator === 'ne') && isSqlNull(value)) {
        return 'null';
    }

    if (operator === 'in' && Array.isArray(value)) {
        const values = readInPredicateValues(value, '');
        return {
            kind: 'array',
            length: values.values.length,
            includesNull: values.includesNull,
        };
    }

    return 'scalar';
}
