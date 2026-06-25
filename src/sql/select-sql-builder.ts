import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { AggregateSelectBuilder } from './aggregate-select-builder';
import { JoinedPredicateSqlCompiler } from './joined-predicate-sql-compiler';
import { JoinedSelectBuilder } from './joined-select-builder';
import { RelationExistenceSqlCompiler } from './relation-existence-sql-compiler';
import { RowSelectBuilder } from './row-select-builder';
import { AggregateQueryBuilder } from './select/aggregate-query-builder';
import { SelectFragmentRenderer } from './select/fragment-renderer';
import { SelectSqlCache } from './select/select-sql-cache';
import { buildSelectSqlCacheKey } from './select-sql-cache-key';
import { collectSelectValues } from './select-value-collector';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';

export interface SelectSqlBuilderOptions {
    readonly maxCacheEntries?: number;
}

export class SelectSqlBuilder {
    private readonly cache: SelectSqlCache;
    private readonly aggregate: AggregateQueryBuilder;
    private readonly joined: JoinedSelectBuilder;
    private readonly row: RowSelectBuilder;

    constructor(
        private readonly dialect: SqlDialect = postgresDialect,
        options: SelectSqlBuilderOptions = {},
    ) {
        this.cache = new SelectSqlCache(options.maxCacheEntries ?? 100);
        const fragments = new SelectFragmentRenderer(dialect);
        const aggregateFragments = new AggregateSelectBuilder(dialect);
        const joinedPredicates = new JoinedPredicateSqlCompiler(dialect);
        const relationExistence = new RelationExistenceSqlCompiler(dialect, fragments);
        this.joined = new JoinedSelectBuilder(
            dialect, fragments, joinedPredicates, relationExistence,
        );
        this.row = new RowSelectBuilder(dialect, fragments, relationExistence);
        this.aggregate = new AggregateQueryBuilder(
            dialect,
            aggregateFragments,
            joinedPredicates,
            relationExistence,
            this.joined,
            fragments,
        );
    }

    public build<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ): SqlStatement {
        assertNoAggregateProjection(query);
        if (query.joins.length > 0) {
            return this.joined.build(metadata, query);
        }

        const cacheKey = buildSelectSqlCacheKey(metadata, query, this.dialect);
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return { text: cached.text, values: collectSelectValues(metadata, query) };
        }

        const statement = this.row.build(metadata, query);
        this.cache.set(cacheKey, { text: statement.text });
        return statement;
    }

    public buildAggregate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ): SqlStatement {
        return this.aggregate.build(metadata, query);
    }

    public buildCount<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ): SqlStatement {
        assertNoAggregateProjection(query);
        return query.joins.length > 0
            ? this.joined.buildCount(metadata, query)
            : this.row.buildCount(metadata, query);
    }

    public buildExists<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ): SqlStatement {
        assertNoAggregateProjection(query);
        return query.joins.length > 0
            ? this.joined.buildExists(metadata, query)
            : this.row.buildExists(metadata, query);
    }
}

export { buildSelectSqlCacheKey };

function assertNoAggregateProjection<TEntity extends object>(
    query: QueryModel<TEntity>,
): void {
    if (query.groupKeys && query.groupKeys.length > 0) {
        throw new Error('Grouped aggregate SQL compilation belongs to buildAggregate().');
    }
    if (query.aggregateProjection && query.aggregateProjection.length > 0) {
        throw new Error('Aggregate projection SQL compilation belongs to buildAggregate().');
    }
}
