/**
 * The public `HavingPredicateExpression` builder — the immutable node wrapper
 * whose `and`/`or`/`not` combinators compose HAVING predicate trees.
 *
 * It sits in its own runtime module, below the field type declarations, so the
 * fluent field-operator types (`AggregateField`/`GroupKeyField`) can name it as
 * a return type without the type module importing a factory — which would form
 * an import cycle. The HAVING operator *builders* that construct these
 * instances live one layer up in `AggregateHaving`.
 */

import type { HavingPredicateNode } from './aggregate-expression-types';

export class HavingPredicateExpression {
    constructor(public readonly node: HavingPredicateNode) {}

    public and(other: HavingPredicateExpression): HavingPredicateExpression {
        return new HavingPredicateExpression({
            kind: 'logical',
            operator: 'and',
            left: this.node,
            right: other.node,
        });
    }

    public or(other: HavingPredicateExpression): HavingPredicateExpression {
        return new HavingPredicateExpression({
            kind: 'logical',
            operator: 'or',
            left: this.node,
            right: other.node,
        });
    }

    public not(): HavingPredicateExpression {
        return new HavingPredicateExpression({
            kind: 'not',
            predicate: this.node,
        });
    }
}
