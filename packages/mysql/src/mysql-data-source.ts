import {
    createEntityKitDataSource,
    type EntityKitDataSource,
    type EntityKitDataSourceOptions,
} from '@entitykit/core/adapter';
import type { MySqlConnectionConfig } from '@entitykit/core';
import { mySqlProviderServices } from './mysql-provider-services';

/** Create an application-scoped MySQL data source backed by one reusable pool. */
export function createMySqlDataSource(
    config: string | MySqlConnectionConfig,
    options: EntityKitDataSourceOptions = {},
): EntityKitDataSource<MySqlConnectionConfig> {
    return createEntityKitDataSource(mySqlProviderServices, config, options);
}
