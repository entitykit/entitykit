import type { EntityPropertyKey } from '../../types';
import type { OrderExpression } from './order-expression';
import { PredicateExpression } from './predicate-expression';
import type { QueryFieldRef } from './predicate-node';
import type { QueryFieldOperand } from './query-field';

export interface FieldToken<TEntity extends object, TProperty = unknown> {
    readonly propertyName: EntityPropertyKey<TEntity>;
    readonly sourceAlias?: string;
    eq(value: TProperty | QueryFieldOperand<TProperty>): PredicateExpression;
    ne(value: TProperty | QueryFieldOperand<TProperty>): PredicateExpression;
    in(values: readonly TProperty[]): PredicateExpression;
    isNull(): PredicateExpression;
    isNotNull(): PredicateExpression;
    asc(): OrderExpression<TEntity>;
    desc(): OrderExpression<TEntity>;
}

export class FieldExpression<TEntity extends object, TProperty = unknown>
implements FieldToken<TEntity, TProperty> {
    constructor(
        public readonly propertyName: EntityPropertyKey<TEntity>,
        public readonly sourceAlias?: string,
    ) {}

    public eq(value: TProperty | QueryFieldOperand<TProperty>): PredicateExpression {
        if (value instanceof FieldExpression) {
            return PredicateExpression.fieldComparison(this.toFieldRef(), 'eq', value.toFieldRef());
        }

        return PredicateExpression.binary(this.propertyName, 'eq', value, this.sourceAlias);
    }

    public ne(value: TProperty | QueryFieldOperand<TProperty>): PredicateExpression {
        if (value instanceof FieldExpression) {
            return PredicateExpression.fieldComparison(this.toFieldRef(), 'ne', value.toFieldRef());
        }

        return PredicateExpression.binary(this.propertyName, 'ne', value, this.sourceAlias);
    }

    public gt(value: TProperty): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'gt', value, this.sourceAlias);
    }

    public gte(value: TProperty): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'gte', value, this.sourceAlias);
    }

    public lt(value: TProperty): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'lt', value, this.sourceAlias);
    }

    public lte(value: TProperty): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'lte', value, this.sourceAlias);
    }

    public like(value: string): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'like', value, this.sourceAlias);
    }

    public contains(value: string): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'contains', value, this.sourceAlias);
    }

    public startsWith(value: string): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'startsWith', value, this.sourceAlias);
    }

    public endsWith(value: string): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'endsWith', value, this.sourceAlias);
    }

    public in(values: readonly TProperty[]): PredicateExpression {
        return PredicateExpression.binary(this.propertyName, 'in', values, this.sourceAlias);
    }

    public isNull(): PredicateExpression {
        return PredicateExpression.null(this.propertyName, 'isNull', this.sourceAlias);
    }

    public isNotNull(): PredicateExpression {
        return PredicateExpression.null(this.propertyName, 'isNotNull', this.sourceAlias);
    }

    public asc(): OrderExpression<TEntity> {
        return {
            propertyName: this.propertyName,
            sourceAlias: this.sourceAlias,
            direction: 'asc',
        };
    }

    public desc(): OrderExpression<TEntity> {
        return {
            propertyName: this.propertyName,
            sourceAlias: this.sourceAlias,
            direction: 'desc',
        };
    }

    public toFieldRef(): QueryFieldRef {
        return {
            sourceAlias: this.sourceAlias,
            propertyName: this.propertyName,
        };
    }
}
