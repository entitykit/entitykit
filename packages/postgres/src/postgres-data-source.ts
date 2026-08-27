import {
    createEntityKitDataSource,
    type EntityKitDataSource,
    type EntityKitDataSourceOptions,
} from '@entitykit/core/adapter';
import type { PostgresConnectionConfig } from '@entitykit/core';
import { postgresProviderServices } from './postgres-provider-services';

/** Create an application-scoped Postgres data source backed by one reusable pool. */
export function createPostgresDataSource(
    config: string | PostgresConnectionConfig,
    options: EntityKitDataSourceOptions = {},
): EntityKitDataSource<PostgresConnectionConfig> {
    return createEntityKitDataSource(postgresProviderServices, config, options);
}
