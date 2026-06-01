import type { EntityPropertyKey } from '../../types';
import type {
    BinaryOperator,
    NullOperator,
    PredicateNode,
    QueryFieldRef,
} from './predicate-node';

export class PredicateExpression {
    constructor(public readonly node: PredicateNode) {}

    public and(other: PredicateExpression): PredicateExpression {
        return new PredicateExpression({
            kind: 'logical',
            operator: 'and',
            left: this.node,
            right: other.node,
        });
    }

    public or(other: PredicateExpression): PredicateExpression {
        return new PredicateExpression({
            kind: 'logical',
            operator: 'or',
            left: this.node,
            right: other.node,
        });
    }

    public not(): PredicateExpression {
        return new PredicateExpression({
            kind: 'not',
            predicate: this.node,
        });
    }

    public static binary<TEntity extends object>(
        propertyName: EntityPropertyKey<TEntity>,
        operator: BinaryOperator,
        value: unknown,
        sourceAlias?: string,
    ): PredicateExpression {
        return new PredicateExpression({
            kind: 'binary',
            operator,
            sourceAlias,
            propertyName,
            value,
        });
    }

    public static fieldComparison(
        left: QueryFieldRef,
        operator: 'eq' | 'ne',
        right: QueryFieldRef,
    ): PredicateExpression {
        return new PredicateExpression({
            kind: 'fieldComparison',
            operator,
            left,
            right,
        });
    }

    public static null<TEntity extends object>(
        propertyName: EntityPropertyKey<TEntity>,
        operator: NullOperator,
        sourceAlias?: string,
    ): PredicateExpression {
        return new PredicateExpression({
            kind: 'null',
            operator,
            propertyName,
            sourceAlias,
        });
    }
}
