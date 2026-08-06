import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import {
    relationshipEndpointExistsSql,
    type AuthorizedManyToManyPair,
} from './many-to-many-authorization';
import { joinEndpointValues } from './modification-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';

export function buildAuthorizedManyToManyInsert(
    dialect: SqlDialect,
    relationship: ManyToManyMetadata,
    pairs: readonly AuthorizedManyToManyPair[],
): SqlStatement {
    if (pairs.length === 0) throw new Error('At least one authorized pair is required.');
    const parameters = new SqlParameterBag(dialect);
    const columns = [
        ...relationship.sourceForeignKeyColumns,
        ...relationship.targetForeignKeyColumns,
    ];
    const selects = pairs.map((pair, index) => {
        const values = joinEndpointValues(
            relationship,
            pair.source.keyValues,
            pair.target.keyValues,
        ).map(value => parameters.add(value));
        const source = relationshipEndpointExistsSql(
            dialect, pair.source, `source_owner_${String(index)}`, parameters,
        );
        const target = relationshipEndpointExistsSql(
            dialect, pair.target, `target_owner_${String(index)}`, parameters,
        );
        return `select ${values.join(', ')} where ${source} and ${target}`;
    });
    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(relationship.joinSchemaName, relationship.joinTableName)} (${columns.map(column => dialect.quoteIdentifier(column)).join(', ')}) ${selects.join(' union all ')} ${dialect.insertConflictDoNothingClause(columns)}`,
        values: parameters.values,
    };
}

export function buildAuthorizedManyToManyDelete(
    dialect: SqlDialect,
    relationship: ManyToManyMetadata,
    pairs: readonly AuthorizedManyToManyPair[],
): SqlStatement {
    if (pairs.length === 0) throw new Error('At least one authorized pair is required.');
    const parameters = new SqlParameterBag(dialect);
    const columns = [
        ...relationship.sourceForeignKeyColumns,
        ...relationship.targetForeignKeyColumns,
    ];
    const predicates = pairs.map((pair, index) => {
        const rowValues = joinEndpointValues(
            relationship,
            pair.source.keyValues,
            pair.target.keyValues,
        );
        const join = columns.map((column, valueIndex) =>
            `${dialect.quoteIdentifier(column)} = ${parameters.add(rowValues[valueIndex])}`,
        );
        const source = relationshipEndpointExistsSql(
            dialect, pair.source, `source_owner_${String(index)}`, parameters,
        );
        const target = relationshipEndpointExistsSql(
            dialect, pair.target, `target_owner_${String(index)}`, parameters,
        );
        return `(${[...join, source, target].join(' and ')})`;
    });
    return {
        text: `delete from ${dialect.quoteQualifiedIdentifier(relationship.joinSchemaName, relationship.joinTableName)} where ${predicates.join(' or ')}`,
        values: parameters.values,
    };
}
