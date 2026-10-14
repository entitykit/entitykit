import {
    createEntityKitDataSource,
    type EntityKitDataSource,
    type EntityKitDataSourceOptions,
} from '@entitykit/core/adapter';
import type { SqliteConnectionConfig } from '@entitykit/core';
import { sqliteProviderServices } from './sqlite-provider-services';
import { SqliteReusableConnectionSource } from './sqlite-reusable-connection-source';

/** SQLite-specific application resource options. */
export interface SqliteDataSourceOptions extends EntityKitDataSourceOptions {
    /** Retain up to this many idle native connections for filesystem databases. Defaults to zero. */
    readonly maxIdleConnections?: number;
}

/** Create an application-scoped SQLite data source for short-lived contexts. */
export function createSqliteDataSource(
    config: string | SqliteConnectionConfig,
    options: SqliteDataSourceOptions = {},
): EntityKitDataSource<SqliteConnectionConfig> {
    const maxIdleConnections = idleConnectionLimit(options.maxIdleConnections);
    const provider = maxIdleConnections === 0 ? sqliteProviderServices : {
        ...sqliteProviderServices,
        createDataSource: (sourceConfig: string | SqliteConnectionConfig) =>
            new SqliteReusableConnectionSource(sourceConfig, maxIdleConnections),
    };
    return createEntityKitDataSource(provider, config, options);
}

function idleConnectionLimit(value: unknown = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error('SQLite maxIdleConnections must be a non-negative safe integer.');
    }
    return value;
}
