import { createDatabaseFacade } from './database-facade';
import type { DatabaseFacade } from './database-facade-types';
import type { DbContextHost } from './db-context-host';

/** Build the high-level database facade around one internal context host. */
export function createDbContextDatabaseFacade(
    host: DbContextHost,
): DatabaseFacade {
    return createDatabaseFacade({
        providerName: () => host.options.provider.provider,
        connection: () => host.connection,
        createScript: () => host.createSchemaScript(),
        createStatements: () => host.createSchemaStatements(),
        sql: async (options, strings, ...values) =>
            host.sql(options, strings, ...values),
        execute: async (options, strings, ...values) =>
            host.execute(options, strings, ...values),
        executeStatement: async (statement, options) =>
            host.executeStatement(statement, options),
        rawSql: (strings, ...values) => host.rawSql(strings, ...values),
    });
}
