import type { EntityMetadata } from '../model/entity-metadata';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';

export interface AuthorizedRelationshipEndpoint {
    readonly metadata: EntityMetadata;
    readonly keyValues: readonly unknown[];
    readonly keyProperties?: readonly string[];
    readonly tenant?: {
        readonly propertyName: string;
        readonly value: unknown;
    };
}

export interface AuthorizedManyToManyPair {
    readonly source: AuthorizedRelationshipEndpoint;
    readonly target: AuthorizedRelationshipEndpoint;
}

export function hasTenantAuthorization(
    pairs: readonly AuthorizedManyToManyPair[],
): boolean {
    return pairs.some(pair => Boolean(pair.source.tenant ?? pair.target.tenant));
}

export function relationshipEndpointPredicateSql(
    dialect: SqlDialect,
    endpoint: AuthorizedRelationshipEndpoint,
    alias: string,
    parameters: SqlParameterBag,
): string {
    const prefix = `${dialect.quoteIdentifier(alias)}.`;
    const keyProperties = endpoint.keyProperties?.map(property =>
        endpoint.metadata.getProperty(property)) ??
        endpoint.metadata.keyPropertiesMetadata;
    const predicates = keyProperties.map((property, index) =>
        `${prefix}${dialect.quoteIdentifier(property.columnName)} = ${parameters.add(endpoint.keyValues[index])}`,
    );
    if (endpoint.tenant) {
        const tenant = endpoint.metadata.getProperty(
            endpoint.tenant.propertyName,
        );
        predicates.push(
            `${prefix}${dialect.quoteIdentifier(tenant.columnName)} = ${parameters.add(endpoint.tenant.value)}`,
        );
    }
    return predicates.join(' and ');
}

export function relationshipEndpointExistsSql(
    dialect: SqlDialect,
    endpoint: AuthorizedRelationshipEndpoint,
    alias: string,
    parameters: SqlParameterBag,
): string {
    const table = dialect.quoteQualifiedIdentifier(
        endpoint.metadata.schemaName,
        endpoint.metadata.tableName,
    );
    return `exists (select 1 from ${table} as ${dialect.quoteIdentifier(alias)} where ${relationshipEndpointPredicateSql(dialect, endpoint, alias, parameters)})`;
}
