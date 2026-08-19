import {
    createEntityKitDataSource,
    type EntityKitDataSource,
    type EntityKitDataSourceOptions,
} from '../../storage/entity-kit-data-source';
import type { MySqlConnectionConfig } from '../../storage/built-in-provider-config';
import { mySqlProviderServices } from './mysql-provider-services';

/** Create my sql data source. */ export function createMySqlDataSource(
    config: string | MySqlConnectionConfig,
    options: EntityKitDataSourceOptions = {},
): EntityKitDataSource<MySqlConnectionConfig> {
    return createEntityKitDataSource(mySqlProviderServices, config, options);
}
