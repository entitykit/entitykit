/**
 * Runtime HAVING operator builders — turn a single operand (an aggregate or a
 * group key) into the fluent `eq`/`gt`/`isNull`/`asc`/… surface, materializing
 * `HavingPredicateExpression` nodes (and sort expressions) as each method is
 * called.
 *
 * This is the shared runtime seam of the "having-expression" concern: both the
 * aggregate proxy and the group-key proxy spread `havingOperators` onto the
 * field objects they hand back, so it lives on its own rather than inside
 * either proxy factory.
 */

import { HavingPredicateExpression } from './aggregate-predicate';
import type { BinaryOperator, NullOperator } from './expression/predicate-node';
import type {
    AggregateOrderExpression,
    HavingOperandExpression,
} from './aggregate-expression-types';
import type { HavingFieldOperators } from './aggregate-field-contracts';

export function havingOperators<TResult>(operand: HavingOperandExpression): HavingFieldOperators<TResult> {
    return {
        eq(value: TResult): HavingPredicateExpression {
            return havingBinary(operand, 'eq', value);
        },
        ne(value: TResult): HavingPredicateExpression {
            return havingBinary(operand, 'ne', value);
        },
        in(values: readonly TResult[]): HavingPredicateExpression {
            return havingBinary(operand, 'in', values);
        },
        isNull(): HavingPredicateExpression {
            return havingNull(operand, 'isNull');
        },
        isNotNull(): HavingPredicateExpression {
            return havingNull(operand, 'isNotNull');
        },
        asc(): AggregateOrderExpression {
            return { operand, direction: 'asc' };
        },
        desc(): AggregateOrderExpression {
            return { operand, direction: 'desc' };
        },
        like(value: string): HavingPredicateExpression {
            return havingBinary(operand, 'like', value);
        },
        contains(value: string): HavingPredicateExpression {
            return havingBinary(operand, 'contains', value);
        },
        startsWith(value: string): HavingPredicateExpression {
            return havingBinary(operand, 'startsWith', value);
        },
        endsWith(value: string): HavingPredicateExpression {
            return havingBinary(operand, 'endsWith', value);
        },
        gt(value: NonNullable<TResult>): HavingPredicateExpression {
            return havingBinary(operand, 'gt', value);
        },
        gte(value: NonNullable<TResult>): HavingPredicateExpression {
            return havingBinary(operand, 'gte', value);
        },
        lt(value: NonNullable<TResult>): HavingPredicateExpression {
            return havingBinary(operand, 'lt', value);
        },
        lte(value: NonNullable<TResult>): HavingPredicateExpression {
            return havingBinary(operand, 'lte', value);
        },
    };
}

function havingBinary(
    operand: HavingOperandExpression,
    operator: BinaryOperator,
    value: unknown,
): HavingPredicateExpression {
    return new HavingPredicateExpression({
        kind: 'binary',
        operand,
        operator,
        value,
    });
}

function havingNull(
    operand: HavingOperandExpression,
    operator: NullOperator,
): HavingPredicateExpression {
    return new HavingPredicateExpression({
        kind: 'null',
        operand,
        operator,
    });
}
