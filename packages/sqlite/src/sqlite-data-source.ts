import {
    createEntityKitDataSource,
    type EntityKitDataSource,
    type EntityKitDataSourceOptions,
} from '@entitykit/core/adapter';
import type { SqliteConnectionConfig } from '@entitykit/core';
import { sqliteProviderServices } from './sqlite-provider-services';

/** Create an application-scoped SQLite data source for short-lived contexts. */
export function createSqliteDataSource(
    config: string | SqliteConnectionConfig,
    options: EntityKitDataSourceOptions = {},
): EntityKitDataSource<SqliteConnectionConfig> {
    return createEntityKitDataSource(sqliteProviderServices, config, options);
}
