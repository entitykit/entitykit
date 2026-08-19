import type { EntityMetadata } from '../../model/entity-metadata';
import type { QueryModel } from '../../query/query-model';
import type { AggregateSelectBuilder } from '../aggregate-select-builder';
import type { JoinedPredicateSqlCompiler } from '../joined-predicate-sql-compiler';
import type { JoinedSelectBuilder } from '../joined-select-builder';
import { PredicateSqlCompiler } from '../predicate-sql-compiler';
import type { RelationExistenceSqlCompiler } from '../relation-existence-sql-compiler';
import type { SelectFragmentHost } from '../select-fragment-host';
import { createSourceMetadataMap } from '../select-sql-helpers';
import type { SqlDialect } from '../sql-dialect';
import { SqlParameterBag, type SqlStatement } from '../sql-statement';

export class AggregateQueryBuilder {
    constructor(
        private readonly dialect: SqlDialect,
        private readonly aggregate: AggregateSelectBuilder,
        private readonly joinedPredicates: JoinedPredicateSqlCompiler,
        private readonly relationExistence: RelationExistenceSqlCompiler,
        private readonly joined: JoinedSelectBuilder,
        private readonly fragments: SelectFragmentHost,
    ) {}

    public build<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ): SqlStatement {
        const hasAggregateProjection = Boolean(query.aggregateProjection?.length);
        const hasGroupKeyProjection = Boolean(query.groupKeyProjection?.length);
        const hasGrouping = Boolean(query.groupKeys?.length);
        if (!hasAggregateProjection && !hasGroupKeyProjection) {
            throw new Error('Aggregate queries must select at least one aggregate or group key expression.');
        }
        if (query.orderings.length > 0) {
            throw new Error('Aggregate projections do not support source orderings.');
        }

        const hasAggregateOrdering = Boolean(query.aggregateOrderings?.length);
        const hasPaging = query.offset !== undefined || query.limit !== undefined;
        if (!hasGrouping && (hasAggregateOrdering || hasPaging)) {
            throw new Error('Only grouped aggregate projections support ordering or paging.');
        }

        const parameters = new SqlParameterBag(this.dialect);
        const hasJoins = query.joins.length > 0;
        const needsSourceAlias = hasJoins || query.relationExistence.length > 0;
        const sourceMetadata = needsSourceAlias
            ? createSourceMetadataMap(metadata, query.joins)
            : undefined;
        const parts = [
            `select ${this.aggregate.aggregateProjectionColumns(metadata, query, sourceMetadata)}`,
            needsSourceAlias
                ? `from ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} ${this.dialect.quoteIdentifier('root')}`
                : `from ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)}`,
        ];

        if (hasJoins && sourceMetadata) {
            parts.push(...this.joined.joinParts(query, parameters, sourceMetadata));
        }

        const wherePredicates: string[] = [];
        if (query.predicate) {
            wherePredicates.push(needsSourceAlias && sourceMetadata
                ? this.joinedPredicates.compile(query.predicate.node, parameters, sourceMetadata)
                : new PredicateSqlCompiler(metadata, parameters, undefined, this.dialect)
                    .compile(query.predicate.node));
        }
        for (const relation of query.relationExistence) {
            wherePredicates.push(this.relationExistence.compile(relation, parameters, 'root'));
        }
        if (wherePredicates.length > 0) {
            parts.push(`where ${wherePredicates.join(' and ')}`);
        }

        if (hasGrouping) {
            parts.push(`group by ${this.aggregate.groupByColumns(metadata, query, sourceMetadata)}`);
        }
        if (query.having) {
            if (!hasGrouping) {
                throw new Error('Having predicates require groupBy().');
            }
            parts.push(
                `having ${this.aggregate.compileHavingPredicate(
                    metadata, query.having.node, parameters, sourceMetadata,
                )}`,
            );
        }
        if (hasAggregateOrdering) {
            parts.push(
                `order by ${this.aggregate.aggregateOrderByColumns(metadata, query, sourceMetadata)}`,
            );
        }

        this.fragments.pushLimitAndOffset(parts, query, parameters);
        return { text: parts.join(' '), values: parameters.values };
    }
}
