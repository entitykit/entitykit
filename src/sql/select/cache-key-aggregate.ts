import type {
    GroupKeyExpression,
    GroupKeyProjectionExpression,
    HavingPredicateNode,
} from '../../query/aggregate';
import { assertNever } from '../select-sql-helpers';
import { predicateValueShape } from './cache-key-predicate';

export function havingPredicateShape(node: HavingPredicateNode): unknown {
    switch (node.kind) {
        case 'binary':
            return {
                kind: node.kind,
                operator: node.operator,
                operand: node.operand,
                valueShape: predicateValueShape(node.operator, node.value),
            };
        case 'null':
            return {
                kind: node.kind,
                operator: node.operator,
                operand: node.operand,
            };
        case 'logical':
            return {
                kind: node.kind,
                operator: node.operator,
                left: havingPredicateShape(node.left),
                right: havingPredicateShape(node.right),
            };
        case 'not':
            return {
                kind: node.kind,
                predicate: havingPredicateShape(node.predicate),
            };
        default:
            return assertNever(node);
    }
}

export function groupKeyShape(
    groupKey: GroupKeyExpression,
): Record<string, unknown> {
    if (groupKey.kind === 'property') {
        return {
            kind: groupKey.kind,
            alias: groupKey.alias,
            sourceAlias: groupKey.sourceAlias,
            propertyName: groupKey.propertyName,
        };
    }

    return {
        kind: groupKey.kind,
        alias: groupKey.alias,
        provider: groupKey.provider,
        precision: groupKey.precision,
        timeZone: groupKey.timeZone,
        sourceAlias: groupKey.sourceAlias,
        propertyName: groupKey.propertyName,
    };
}

export function groupKeyProjectionShape(
    groupKey: GroupKeyProjectionExpression,
): Record<string, unknown> {
    return {
        ...groupKeyShape({
            ...groupKey,
            alias: groupKey.keyAlias,
        }),
        alias: groupKey.alias,
        keyAlias: groupKey.keyAlias,
    };
}
