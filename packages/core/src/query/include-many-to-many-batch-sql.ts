import { PredicateSqlCompiler } from '../sql/predicate-sql-compiler';
import type { SqlDialect } from '../sql/sql-dialect';
import {
    SqlParameterBag,
    type SqlStatement,
} from '../sql/sql-statement';
import type {
    ManyToManyRelationshipInfo,
    QueryFilterApplier,
} from './include-loader-context';
import {
    includeOrderBy,
    joinKeyPredicate,
    parentKeyAliasAt,
    relatedJoinPredicate,
} from './include-loader-sql';
import {
    cloneQueryModel,
    createQueryModel,
    type IncludeFilterModel,
} from './query-model';

export function buildManyToManyBatchStatement(
    dialect: SqlDialect,
    applyQueryFilters: QueryFilterApplier | undefined,
    info: ManyToManyRelationshipInfo,
    currentKeys: ReadonlyArray<readonly unknown[]>,
    filter?: IncludeFilterModel,
): SqlStatement {
    const parameters = new SqlParameterBag(dialect);
    const relatedQuery = cloneQueryModel(
        createQueryModel(info.relatedMetadata.ctor),
        {
            predicate: filter?.predicate,
            orderings: filter?.orderings,
            offset: filter?.offset,
            limit: filter?.limit,
        },
    );
    const filteredRelatedQuery = applyQueryFilters
        ? applyQueryFilters(info.relatedMetadata, relatedQuery)
        : relatedQuery;
    const columns = info.relatedMetadata.properties
        .map(property =>
            `${dialect.quoteIdentifier('t')}.`
      + `${dialect.quoteIdentifier(property.columnName)} as `
      + dialect.quoteIdentifier(property.columnName),
        )
        .join(', ');
    const parentKeySelect = info.currentJoinColumns
        .map((column, index) =>
            `${dialect.quoteIdentifier('j')}.`
      + `${dialect.quoteIdentifier(column)} as `
      + dialect.quoteIdentifier(parentKeyAliasAt(index)),
        )
        .join(', ');
    const parts = [
        `select ${parentKeySelect}, ${columns}`,
        `from ${dialect.quoteQualifiedIdentifier(
            info.relationship.joinSchemaName,
            info.relationship.joinTableName,
        )} ${dialect.quoteIdentifier('j')}`,
        `join ${dialect.quoteQualifiedIdentifier(
            info.relatedMetadata.schemaName,
            info.relatedMetadata.tableName,
        )} ${dialect.quoteIdentifier('t')} on ${
            relatedJoinPredicate(dialect, info)
        }`,
        `where ${joinKeyPredicate(
            dialect,
            info,
            currentKeys,
            parameters,
        )}`,
    ];

    if (filteredRelatedQuery.predicate) {
        const predicate = new PredicateSqlCompiler(
            info.relatedMetadata,
            parameters,
            't',
            dialect,
        ).compile(filteredRelatedQuery.predicate.node);
        parts.push(`and ${predicate}`);
    }

    if (filteredRelatedQuery.orderings.length) {
        parts.push(
            `order by ${includeOrderBy(
                dialect,
                info.relatedMetadata,
                filteredRelatedQuery.orderings,
                't',
            )}`,
        );
    }

    if (filteredRelatedQuery.limit !== undefined) {
        parts.push(`limit ${parameters.add(filteredRelatedQuery.limit)}`);
    }

    if (filteredRelatedQuery.offset !== undefined) {
        parts.push(`offset ${parameters.add(filteredRelatedQuery.offset)}`);
    }

    return {
        text: parts.join(' '),
        values: parameters.values,
    };
}
