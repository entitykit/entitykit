import {
    relationshipEndpointPredicateSql,
    type AuthorizedRelationshipEndpoint,
} from './many-to-many-authorization';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';

export function buildRelationshipAuthorizationQuery(
    dialect: SqlDialect,
    endpoint: AuthorizedRelationshipEndpoint,
): SqlStatement {
    const parameters = new SqlParameterBag(dialect);
    const alias = 'relationship_principal';
    const table = dialect.quoteQualifiedIdentifier(
        endpoint.metadata.schemaName,
        endpoint.metadata.tableName,
    );
    const predicate = relationshipEndpointPredicateSql(
        dialect,
        endpoint,
        alias,
        parameters,
    );
    const lock = dialect.rowLockClause?.() ?? '';
    return {
        text: `select 1 as ${dialect.quoteIdentifier('authorized')} from ${table} as ${dialect.quoteIdentifier(alias)} where ${predicate}${lock ? ` ${lock}` : ''}`,
        values: parameters.values,
    };
}
