import {
    type AggregateField,
    type GroupKeyField,
} from './aggregate';
import type { AggregateOrderExpression as CompiledAggregateOrderExpression } from './aggregate-expression-types';
import type { AggregateOrderExpression } from './aggregate-order-types';
import { FieldExpression } from './expression/field-expression';
import type { OrderExpression } from './expression/order-expression';
import type { QueryField } from './expression/query-field';

export type JoinedOrderExpression =
    OrderExpression<Record<string, unknown>>;

export function normalizeOrdering(
    selected: QueryField<unknown> | JoinedOrderExpression,
    defaultDirection: 'asc' | 'desc',
): JoinedOrderExpression {
    if ('direction' in selected) {
        return selected;
    }

    if (selected instanceof FieldExpression) {
        return {
            propertyName:
        selected.propertyName,
            sourceAlias: selected.sourceAlias,
            direction: defaultDirection,
        };
    }

    throw new Error(
        'orderBy selectors must return a query field or order expression.',
    );
}

export function normalizeAggregateOrdering(
    selected:
    | AggregateField
    | GroupKeyField
    | AggregateOrderExpression,
    defaultDirection: 'asc' | 'desc',
): CompiledAggregateOrderExpression {
    if ('direction' in selected) {
        if (!('operand' in selected)) {
            throw new Error(
                'grouped ordering expressions must be created by EntityKit.',
            );
        }
        return selected as CompiledAggregateOrderExpression;
    }

    return {
        operand: 'keyAlias' in selected
            ? {
                kind: 'groupKey',
                keyAlias: selected.keyAlias,
                expressionKind: selected.expressionKind,
                provider: selected.provider,
                precision: selected.precision,
                timeZone: selected.timeZone,
                sourceAlias: selected.sourceAlias,
                propertyName: selected.propertyName,
            }
            : {
                kind: 'aggregate',
                function: selected.function,
                sourceAlias: selected.sourceAlias,
                propertyName: selected.propertyName,
            },
        direction: defaultDirection,
    };
}
