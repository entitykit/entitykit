import type { EntityMetadata } from '../../model/entity-metadata';
import type { HavingOperandExpression, HavingPredicateNode } from '../../query/aggregate';
import type { BinaryOperator } from '../../query/expression/predicate-node';
import {
    compileInPredicate,
    isSqlNull,
    readInPredicateValues,
} from '../predicate-null-semantics';
import {
    assertNever,
    likeEscapeClause,
    sqlBinaryOperator,
    stringPatternValue,
} from '../select-sql-helpers';
import type { SqlDialect } from '../sql-dialect';
import type { SqlParameterBag } from '../sql-statement';
import type { AggregateExpressionRenderer } from './aggregate-expression-renderer';

export class HavingPredicateCompiler {
    constructor(
        private readonly dialect: SqlDialect,
        private readonly expressions: AggregateExpressionRenderer,
    ) {}

    public compile<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        node: HavingPredicateNode,
        parameters: SqlParameterBag,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        switch (node.kind) {
            case 'binary':
                return this.compileBinary(
                    metadata, node.operand, node.operator, node.value, parameters, sourceMetadata,
                );
            case 'null':
                return `${this.expressions.havingOperandSql(metadata, node.operand, sourceMetadata)} ${node.operator === 'isNull' ? 'is null' : 'is not null'}`;
            case 'logical':
                return `(${this.compile(metadata, node.left, parameters, sourceMetadata)} ${node.operator} ${this.compile(metadata, node.right, parameters, sourceMetadata)})`;
            case 'not':
                return `(not ${this.compile(metadata, node.predicate, parameters, sourceMetadata)})`;
            default:
                return assertNever(node);
        }
    }

    private compileBinary<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        operand: HavingOperandExpression,
        operator: BinaryOperator,
        value: unknown,
        parameters: SqlParameterBag,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        const expression = this.expressions.havingOperandSql(
            metadata, operand, sourceMetadata,
        );
        if ((operator === 'eq' || operator === 'ne') && isSqlNull(value)) {
            return `${expression} ${operator === 'eq' ? 'is null' : 'is not null'}`;
        }

        if (operator === 'in') {
            return compileInPredicate(
                expression,
                readInPredicateValues(
                    value,
                    'The \'in\' operator for having predicates requires an array value.',
                ),
                item => parameters.add(
                    this.expressions.havingProviderValue(
                        metadata, operand, item, sourceMetadata,
                    ),
                ),
                () => this.dialect.falsePredicate(),
            );
        }

        const sqlOperator = sqlBinaryOperator(operator);
        const parameterValue = stringPatternValue(
            operator,
            this.expressions.havingProviderValue(metadata, operand, value, sourceMetadata),
        );
        return `${expression} ${sqlOperator} ${parameters.add(parameterValue)}${likeEscapeClause(operator)}`;
    }
}
