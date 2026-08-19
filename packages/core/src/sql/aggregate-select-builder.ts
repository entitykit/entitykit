import type { EntityMetadata } from '../model/entity-metadata';
import type { HavingPredicateNode } from '../query/aggregate';
import type { QueryModel } from '../query/query-model';
import { AggregateExpressionRenderer } from './aggregate/aggregate-expression-renderer';
import { HavingPredicateCompiler } from './aggregate/having-predicate-compiler';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';

export class AggregateSelectBuilder {
    private readonly expressions: AggregateExpressionRenderer;
    private readonly having: HavingPredicateCompiler;

    constructor(private readonly dialect: SqlDialect) {
        this.expressions = new AggregateExpressionRenderer(dialect);
        this.having = new HavingPredicateCompiler(dialect, this.expressions);
    }

    public aggregateProjectionColumns<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        return [
            this.groupKeySelectColumns(metadata, query, sourceMetadata),
            this.aggregateSelectColumns(metadata, query, sourceMetadata),
        ].filter(Boolean).join(', ');
    }

    public groupByColumns<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        return (query.groupKeys ?? [])
            .map(groupKey => this.expressions.groupKeySql(
                metadata, groupKey, sourceMetadata,
            ))
            .join(', ');
    }

    public aggregateOrderByColumns<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        return (query.aggregateOrderings ?? [])
            .map(ordering => {
                const direction = ordering.direction === 'desc' ? 'desc' : 'asc';
                const operand = this.expressions.havingOperandSql(
                    metadata, ordering.operand, sourceMetadata,
                );
                const prefix = this.dialect.nullOrderingPrefix?.(operand, direction) ?? '';
                const suffix = this.dialect.nullOrderingClause?.(direction) ?? '';
                return `${prefix}${operand} ${direction}${suffix}`;
            })
            .join(', ');
    }

    public compileHavingPredicate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        node: HavingPredicateNode,
        parameters: SqlParameterBag,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        return this.having.compile(metadata, node, parameters, sourceMetadata);
    }

    private aggregateSelectColumns<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        return (query.aggregateProjection ?? [])
            .map(aggregate => {
                const expression = aggregate.propertyName
                    ? this.expressions.aggregateFunctionSql(
                        aggregate.function,
                        this.expressions.aggregateColumnSql(
                            metadata, aggregate.sourceAlias, aggregate.propertyName, sourceMetadata,
                        ),
                    )
                    : this.dialect.countAllExpression();
                return `${expression} as ${this.dialect.quoteIdentifier(aggregate.alias)}`;
            })
            .join(', ');
    }

    private groupKeySelectColumns<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        return (query.groupKeyProjection ?? [])
            .map(groupKey =>
                `${this.expressions.groupKeySql(metadata, groupKey, sourceMetadata)} as ${this.dialect.quoteIdentifier(groupKey.alias)}`,
            )
            .join(', ');
    }
}
