import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';
import type { EntityMetadata } from '../model/entity-metadata';
import { toProviderValue } from '../model/value-converter/store-value';
import type {
    RawSqlQueryFilters,
    RawSqlQueryHost,
} from '../query/raw-sql-query-host';
import { SqlParameterBag, type SqlStatement } from '../sql/sql-statement';
import type { DbSetContext } from './db-set-context';

const rawSourceAlias = '__entitykit_raw';

export function createDbSetRawQueryHost(
    context: DbSetContext,
): RawSqlQueryHost {
    return {
        get database() {
            return context.database;
        },
        changeTracker: context.changeTracker,
        get valueReader() {
            return context.valueReader;
        },
        assertCanQuery: operation => {
            context.assertCanQuery(operation);
        },
        buildStatement: (metadata, statement, filters) =>
            buildFilteredRawStatement(context, metadata, statement, filters),
    };
}

function buildFilteredRawStatement<TEntity extends object>(
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
    statement: SqlStatement,
    filters: RawSqlQueryFilters,
): SqlStatement {
    const predicates: string[] = [];
    if (metadata.softDelete && !filters.ignoreQueryFilters) {
        const property = metadata.getProperty(metadata.softDelete.propertyName);
        predicates.push(`${qualifiedColumn(context, property.columnName)} is null`);
    }

    let values = [...statement.values];
    if (
        metadata.tenantKeyProperty &&
        !filters.ignoreTenantScope &&
        !context.allowsCrossTenantAccess()
    ) {
        const tenantId = context.currentTenantIdForWrites();
        if (tenantId === undefined || tenantId === null) {
            throw new TenantScopeUnavailableError(metadata.entityName);
        }
        const property = metadata.getProperty(metadata.tenantKeyProperty);
        const parameters = new SqlParameterBag(context.dialect);
        for (const value of values) {
            parameters.add(value);
        }
        const parameter = parameters.add(toProviderValue(
            tenantId,
            property.converter as never,
        ));
        values = [...parameters.values];
        predicates.push(`${qualifiedColumn(context, property.columnName)} = ${parameter}`);
    }

    if (predicates.length === 0) {
        return { ...statement, values };
    }
    const alias = context.dialect.quoteIdentifier(rawSourceAlias);
    return {
        ...statement,
        text: `select * from (${statement.text}) as ${alias} where ${predicates.join(' and ')}`,
        values,
    };
}

function qualifiedColumn(context: DbSetContext, columnName: string): string {
    return context.dialect.quoteQualifiedIdentifier(rawSourceAlias, columnName);
}
