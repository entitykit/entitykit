import {
    relationshipEndpointPredicateSql,
    type AuthorizedManyToManyPair,
} from './many-to-many-authorization';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';

/** Lock and prove both persisted endpoint owners for every relationship row. */
export function buildManyToManyAuthorizationQuery(
    dialect: SqlDialect,
    pairs: readonly AuthorizedManyToManyPair[],
): SqlStatement {
    if (pairs.length === 0) throw new Error('At least one authorized pair is required.');
    const first = pairs[0];
    const parameters = new SqlParameterBag(dialect);
    const sourceAlias = 'source_endpoint';
    const targetAlias = 'target_endpoint';
    const sourceTable = dialect.quoteQualifiedIdentifier(
        first.source.metadata.schemaName,
        first.source.metadata.tableName,
    );
    const targetTable = dialect.quoteQualifiedIdentifier(
        first.target.metadata.schemaName,
        first.target.metadata.tableName,
    );
    const predicates = pairs.map(pair => `(${[
        relationshipEndpointPredicateSql(
            dialect, pair.source, sourceAlias, parameters,
        ),
        relationshipEndpointPredicateSql(
            dialect, pair.target, targetAlias, parameters,
        ),
    ].join(' and ')})`);
    const lock = dialect.rowLockClause?.() ?? '';
    return {
        text: `select 1 as ${dialect.quoteIdentifier('authorized')} from ${sourceTable} as ${dialect.quoteIdentifier(sourceAlias)} cross join ${targetTable} as ${dialect.quoteIdentifier(targetAlias)} where ${predicates.join(' or ')}${lock ? ` ${lock}` : ''}`,
        values: parameters.values,
    };
}
