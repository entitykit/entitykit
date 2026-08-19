import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { PredicateSqlCompiler } from './predicate-sql-compiler';
import type { RelationExistenceSqlCompiler } from './relation-existence-sql-compiler';
import { buildRowSelectColumns } from './row-select-projection';
import {
    buildCountStatement,
    buildExistsStatement,
} from './select-terminal-statement';
import type { SelectFragmentHost } from './select-fragment-host';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';

/**
 * Builds `select` / `count` / `exists` SQL for single-source (non-joined)
 * queries — the common read path.
 *
 * Held apart from the joined builder because a single-table query names its
 * columns without an alias map and threads relation-existence subqueries and
 * the optional `root` alias through a `where` clause the joined path never
 * uses. Relation-existence predicates are delegated to the shared
 * {@link RelationExistenceSqlCompiler}; ordering and paging arrive through
 * {@link SelectFragmentHost}, so the
 * `SqlParameterBag.add(...)` order — projection literals, then predicate, then
 * relation existence, then limit/offset — is unchanged.
 */
export class RowSelectBuilder {
    constructor(
        private readonly dialect: SqlDialect,
        private readonly host: SelectFragmentHost,
        private readonly relationExistence: RelationExistenceSqlCompiler,
    ) {}

    public build<TEntity extends object>(metadata: EntityMetadata<TEntity>, query: QueryModel<TEntity>): SqlStatement {
        const parameters = new SqlParameterBag(this.dialect);
        const rootAlias = query.relationExistence.length > 0 ? 'root' : undefined;
        const columns = buildRowSelectColumns(
            this.dialect,
            this.host,
            metadata,
            query,
            parameters,
            rootAlias,
        );
        const parts = this.buildSelectParts(
            metadata,
            query,
            parameters,
            columns,
            rootAlias,
        );
        return {
            text: parts.join(' '),
            values: parameters.values,
        };
    }

    public buildCount<TEntity extends object>(metadata: EntityMetadata<TEntity>, query: QueryModel<TEntity>): SqlStatement {
        const parameters = new SqlParameterBag(this.dialect);
        const rootAlias = query.relationExistence.length > 0 ? 'root' : undefined;
        const predicates = this.rootWherePredicates(metadata, query, parameters, rootAlias);
        const paging: string[] = [];
        this.host.pushLimitAndOffset(paging, query, parameters);
        return buildCountStatement(
            this.dialect,
            [this.fromClause(metadata, rootAlias)],
            predicates.length > 0 ? predicates.join(' and ') : undefined,
            parameters.values,
            paging,
        );
    }

    public buildExists<TEntity extends object>(metadata: EntityMetadata<TEntity>, query: QueryModel<TEntity>): SqlStatement {
        const parameters = new SqlParameterBag(this.dialect);
        const rootAlias = query.relationExistence.length > 0 ? 'root' : undefined;
        const predicates = this.rootWherePredicates(metadata, query, parameters, rootAlias);
        const paging: string[] = [];
        this.host.pushLimitAndOffset(paging, query, parameters);
        return buildExistsStatement(
            this.dialect,
            [this.fromClause(metadata, rootAlias)],
            predicates.length > 0 ? predicates.join(' and ') : undefined,
            parameters.values,
            paging,
        );
    }

    private buildSelectParts<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
        parameters: SqlParameterBag,
        columns: string,
        rootAlias?: string,
    ): string[] {
        const parts = [
            `select ${columns}`,
            this.fromClause(metadata, rootAlias),
        ];

        const predicates = this.rootWherePredicates(metadata, query, parameters, rootAlias);
        if (predicates.length > 0) {
            parts.push(`where ${predicates.join(' and ')}`);
        }

        if (query.orderings.length > 0) {
            const orderings = query.orderings
                .map(ordering => {
                    const property = metadata.getProperty(ordering.propertyName);
                    return this.host.orderTerm(this.host.columnSql(property.columnName, rootAlias), ordering.direction);
                })
                .join(', ');
            parts.push(`order by ${orderings}`);
        }

        this.host.pushLimitAndOffset(parts, query, parameters);

        return parts;
    }

    private fromClause<TEntity extends object>(metadata: EntityMetadata<TEntity>, alias?: string): string {
        const table = this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName);
        return alias ? `from ${table} ${this.dialect.quoteIdentifier(alias)}` : `from ${table}`;
    }

    private rootWherePredicates<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
        parameters: SqlParameterBag,
        rootAlias?: string,
    ): string[] {
        const predicates: string[] = [];
        if (query.predicate) {
            predicates.push(new PredicateSqlCompiler(metadata, parameters, rootAlias, this.dialect).compile(query.predicate.node));
        }

        for (const relation of query.relationExistence) {
            predicates.push(this.relationExistence.compile(relation, parameters, rootAlias ?? 'root'));
        }

        return predicates;
    }
}
