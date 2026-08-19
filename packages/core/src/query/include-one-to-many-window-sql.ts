import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import { PredicateSqlCompiler } from '../sql/predicate-sql-compiler';
import type { SqlDialect } from '../sql/sql-dialect';
import {
    SqlParameterBag,
    type SqlStatement,
} from '../sql/sql-statement';
import { FieldExpression } from './expression/field-expression';
import type { QueryFilterApplier } from './include-loader-context';
import {
    includeOrderBy,
    includeOuterColumns,
    includeSubqueryAlias,
    parentKeyAlias,
    rowNumberAlias,
    windowPredicate,
} from './include-loader-sql';
import {
    cloneQueryModel,
    createQueryModel,
    type IncludeFilterModel,
} from './query-model';

export function buildOneToManyWindowStatement<
    TPrincipal extends object,
>(
    dialect: SqlDialect,
    applyQueryFilters: QueryFilterApplier | undefined,
    dependentMetadata: EntityMetadata,
    relationship: RelationshipMetadata<object, TPrincipal>,
    principalKeys: readonly unknown[],
    filter: IncludeFilterModel,
): SqlStatement {
    const parameters = new SqlParameterBag(dialect);
    const foreignKey = relationship.foreignKeyProperties[0];
    const basePredicate =
        new FieldExpression(foreignKey).in(principalKeys);
    const predicate = filter.predicate
        ? basePredicate.and(filter.predicate)
        : basePredicate;
    const query = cloneQueryModel(
        createQueryModel(dependentMetadata.ctor),
        {
            predicate,
            orderings: filter.orderings,
        },
    );
    const filteredQuery = applyQueryFilters
        ? applyQueryFilters(dependentMetadata, query)
        : query;
    const columns = dependentMetadata.properties.map(property =>
        `${dialect.quoteIdentifier('t')}.`
    + `${dialect.quoteIdentifier(property.columnName)} as `
    + dialect.quoteIdentifier(property.columnName),
    );
    const parentKeyColumn =
        `${dialect.quoteIdentifier('t')}.`
    + dialect.quoteIdentifier(
        dependentMetadata.getProperty(foreignKey).columnName,
    );
    const innerSelect = [
        ...columns,
        `${parentKeyColumn} as ${dialect.quoteIdentifier(parentKeyAlias)}`,
        `row_number() over (partition by ${parentKeyColumn} order by ${
            includeOrderBy(
                dialect,
                dependentMetadata,
                filteredQuery.orderings,
                't',
            )
        }) as ${dialect.quoteIdentifier(rowNumberAlias)}`,
    ].join(', ');
    const filteredPredicate = filteredQuery.predicate;
    if (!filteredPredicate) {
        throw new Error(
            'A one-to-many window query must have a parent-key predicate.',
        );
    }
    const predicateSql = new PredicateSqlCompiler(
        dependentMetadata,
        parameters,
        't',
        dialect,
    ).compile(filteredPredicate.node);
    const innerParts = [
        `select ${innerSelect}`,
        `from ${dialect.quoteQualifiedIdentifier(
            dependentMetadata.schemaName,
            dependentMetadata.tableName,
        )} ${dialect.quoteIdentifier('t')}`,
        `where ${predicateSql}`,
    ];
    const outerParts = [
        `select ${includeOuterColumns(dialect, dependentMetadata)}`,
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
