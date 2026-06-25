import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { JoinedPredicateSqlCompiler } from './joined-predicate-sql-compiler';
import { buildJoinedSelectColumns } from './joined-select-projection';
import type { RelationExistenceSqlCompiler } from './relation-existence-sql-compiler';
import {
    buildCountStatement,
    buildExistsStatement,
} from './select-terminal-statement';
import type { SelectFragmentHost } from './select-fragment-host';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { createSourceMetadataMap, metadataForSource, normalizeSourceAlias } from './select-sql-helpers';

/**
 * Builds `select` / `count` / `exists` SQL for multi-source (joined) queries.
 *
 * Held apart from the row builder because joined queries name every column
 * through an alias -> metadata map and require a projection, which is a
 * different assembly than the single-table row path. Ordering and paging arrive
 * through the shared {@link SelectFragmentHost}, and this builder shares one
 * {@link JoinedPredicateSqlCompiler} instance, so `where`/`on` compilation and
 * every `SqlParameterBag.add(...)` stay identical to the pre-split order. The
 * aggregate path also reuses {@link joinParts} from here.
 */
export class JoinedSelectBuilder {
    constructor(
        private readonly dialect: SqlDialect,
        private readonly host: SelectFragmentHost,
        private readonly joinedPredicates: JoinedPredicateSqlCompiler,
        private readonly relationExistence: RelationExistenceSqlCompiler,
    ) {}

    /**
   * The `where` body for a joined query: the compiled predicate (if any)
   * followed by each `whereExists`/`whereNotExists` relation filter, correlated
   * to the joined root (aliased `root`). Returns undefined when there is nothing
   * to filter on.
   */
    private whereClause<TEntity extends object>(
        query: QueryModel<TEntity>,
        parameters: SqlParameterBag,
        sourceMetadata: ReadonlyMap<string, EntityMetadata>,
    ): string | undefined {
        const predicates: string[] = [];
        if (query.predicate) {
            predicates.push(this.joinedPredicates.compile(query.predicate.node, parameters, sourceMetadata));
        }
        for (const relation of query.relationExistence) {
            predicates.push(this.relationExistence.compile(relation, parameters, 'root'));
        }
        return predicates.length > 0 ? predicates.join(' and ') : undefined;
    }

    public build<TEntity extends object>(metadata: EntityMetadata<TEntity>, query: QueryModel<TEntity>): SqlStatement {
        if (!query.projection || query.projection.length === 0) {
            throw new Error('Joined queries must select a projection before SQL can be built.');
        }

        const parameters = new SqlParameterBag(this.dialect);
        const sourceMetadata = createSourceMetadataMap(metadata, query.joins);
        const parts = [
            `select ${buildJoinedSelectColumns(this.dialect, query, parameters, sourceMetadata)}`,
            `from ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} ${this.dialect.quoteIdentifier('root')}`,
        ];

        parts.push(...this.joinParts(query, parameters, sourceMetadata));

        const where = this.whereClause(query, parameters, sourceMetadata);
        if (where) {
            parts.push(`where ${where}`);
        }

        if (query.orderings.length > 0) {
            const orderings = query.orderings
                .map(ordering => {
                    const sourceAlias = normalizeSourceAlias(ordering.sourceAlias);
                    const source = metadataForSource(sourceMetadata, sourceAlias);
                    const property = source.getProperty(ordering.propertyName);
                    return this.host.orderTerm(`${this.dialect.quoteIdentifier(sourceAlias)}.${this.dialect.quoteIdentifier(property.columnName)}`, ordering.direction);
                })
                .join(', ');
            parts.push(`order by ${orderings}`);
        }

        this.host.pushLimitAndOffset(parts, query, parameters);

        return {
            text: parts.join(' '),
            values: parameters.values,
        };
    }

    public buildCount<TEntity extends object>(metadata: EntityMetadata<TEntity>, query: QueryModel<TEntity>): SqlStatement {
        const parameters = new SqlParameterBag(this.dialect);
        const sourceMetadata = createSourceMetadataMap(metadata, query.joins);
        const fromParts = [
            `from ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} ${this.dialect.quoteIdentifier('root')}`,
            ...this.joinParts(query, parameters, sourceMetadata),
        ];
        const where = this.whereClause(query, parameters, sourceMetadata);
        const paging: string[] = [];
        this.host.pushLimitAndOffset(paging, query, parameters);
        return buildCountStatement(
            this.dialect,
            fromParts,
            where,
            parameters.values,
            paging,
        );
    }

    public buildExists<TEntity extends object>(metadata: EntityMetadata<TEntity>, query: QueryModel<TEntity>): SqlStatement {
        const parameters = new SqlParameterBag(this.dialect);
        const sourceMetadata = createSourceMetadataMap(metadata, query.joins);
        const fromParts = [
            `from ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} ${this.dialect.quoteIdentifier('root')}`,
            ...this.joinParts(query, parameters, sourceMetadata),
        ];
        const where = this.whereClause(query, parameters, sourceMetadata);
        const paging: string[] = [];
        this.host.pushLimitAndOffset(paging, query, parameters);
        return buildExistsStatement(
            this.dialect,
            fromParts,
            where,
            parameters.values,
            paging,
        );
    }

    public joinParts<TEntity extends object>(
        query: QueryModel<TEntity>,
        parameters: SqlParameterBag,
        sourceMetadata: ReadonlyMap<string, EntityMetadata>,
    ): string[] {
        return query.joins.map(join => {
            return [
                join.kind === 'left' ? 'left join' : 'inner join',
                `${this.dialect.quoteQualifiedIdentifier(join.metadata.schemaName, join.metadata.tableName)} ${this.dialect.quoteIdentifier(join.alias)}`,
                'on',
                this.joinedPredicates.compile(join.predicate.node, parameters, sourceMetadata),
            ].join(' ');
        });
    }
}
