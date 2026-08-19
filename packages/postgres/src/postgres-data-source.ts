import {
    createEntityKitDataSource,
    type EntityKitDataSource,
    type EntityKitDataSourceOptions,
} from '../../storage/entity-kit-data-source';
import type { PostgresConnectionConfig } from '../../storage/built-in-provider-config';
import { postgresProviderServices } from './postgres-provider-services';

/** Create postgres data source. */ export function createPostgresDataSource(
    config: string | PostgresConnectionConfig,
    options: EntityKitDataSourceOptions = {},
): EntityKitDataSource<PostgresConnectionConfig> {
    return createEntityKitDataSource(postgresProviderServices, config, options);
}
