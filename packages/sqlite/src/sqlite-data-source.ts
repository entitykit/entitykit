import {
    createEntityKitDataSource,
    type EntityKitDataSource,
    type EntityKitDataSourceOptions,
} from '../../storage/entity-kit-data-source';
import type { SqliteConnectionConfig } from '../../storage/built-in-provider-config';
import { sqliteProviderServices } from './sqlite-provider-services';

/** Create sqlite data source. */ export function createSqliteDataSource(
    config: string | SqliteConnectionConfig,
    options: EntityKitDataSourceOptions = {},
): EntityKitDataSource<SqliteConnectionConfig> {
    return createEntityKitDataSource(sqliteProviderServices, config, options);
}
