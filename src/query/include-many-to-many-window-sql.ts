import { toBoundPropertyValue } from '../model/value-converter/store-value';
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
    includeOuterColumns,
    includeSubqueryAlias,
    parentKeyAlias,
    relatedJoinPredicate,
    rowNumberAlias,
    windowPredicate,
} from './include-loader-sql';
import {
    cloneQueryModel,
    createQueryModel,
    type IncludeFilterModel,
} from './query-model';

export function buildManyToManyWindowStatement(
    dialect: SqlDialect,
    applyQueryFilters: QueryFilterApplier | undefined,
    info: ManyToManyRelationshipInfo,
    currentKeys: ReadonlyArray<readonly unknown[]>,
    filter: IncludeFilterModel,
): SqlStatement {
    const parameters = new SqlParameterBag(dialect);
    const relatedQuery = cloneQueryModel(
        createQueryModel(info.relatedMetadata.ctor),
        {
            predicate: filter.predicate,
            orderings: filter.orderings,
        },
    );
    const filteredRelatedQuery = applyQueryFilters
        ? applyQueryFilters(info.relatedMetadata, relatedQuery)
        : relatedQuery;
    const columns = info.relatedMetadata.properties.map(property =>
        `${dialect.quoteIdentifier('t')}.`
    + `${dialect.quoteIdentifier(property.columnName)} as `
    + dialect.quoteIdentifier(property.columnName),
    );

    // Parent keys originate in model form; bind their provider representation.
    // They are deliberately added before filter and window parameters.
    const keyProperty = info.currentMetadata.keyPropertiesMetadata[0];
    const keyParameters = currentKeys
        .map(tuple =>
            parameters.add(
                toBoundPropertyValue(
                    tuple[0],
                    keyProperty,
                    info.currentMetadata.entityName,
                ),
            ),
        )
        .join(', ');
    const parentKeyColumn =
        `${dialect.quoteIdentifier('j')}.`
    + dialect.quoteIdentifier(info.currentJoinColumns[0]);
    const innerSelect = [
        `${parentKeyColumn} as ${dialect.quoteIdentifier(parentKeyAlias)}`,
        ...columns,
        `row_number() over (partition by ${parentKeyColumn} order by ${
            includeOrderBy(
                dialect,
                info.relatedMetadata,
                filteredRelatedQuery.orderings,
                't',
            )
        }) as ${dialect.quoteIdentifier(rowNumberAlias)}`,
    ].join(', ');
    const innerParts = [
        `select ${innerSelect}`,
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
        `where ${parentKeyColumn} in (${keyParameters})`,
    ];

    if (filteredRelatedQuery.predicate) {
        const predicate = new PredicateSqlCompiler(
            info.relatedMetadata,
            parameters,
            't',
            dialect,
        ).compile(filteredRelatedQuery.predicate.node);
        innerParts.push(`and ${predicate}`);
    }

    const outerParts = [
        `select ${includeOuterColumns(dialect, info.relatedMetadata)}`,
        `from (${innerParts.join(' ')}) ${
            dialect.quoteIdentifier(includeSubqueryAlias)
        }`,
        `where ${windowPredicate(dialect, parameters, filter)}`,
        `order by ${dialect.quoteIdentifier(includeSubqueryAlias)}.${
            dialect.quoteIdentifier(parentKeyAlias)
        }, ${dialect.quoteIdentifier(includeSubqueryAlias)}.${
            dialect.quoteIdentifier(rowNumberAlias)
        }`,
    ];

    return {
        text: outerParts.join(' '),
        values: parameters.values,
    };
}
