import { assertSynchronousCallbackResult } from '../synchronous-callback';
import type { DatabaseConnection } from './database-connection';
import type { DatabaseConnectionSource } from './database-data-source';
import type {
    DatabaseProviderConnectionConfig,
    DatabaseProviderServices,
} from './database-provider-services';
import { DataSourceConnectionLease } from './data-source-connection-lease';

export function resolveDataSourceConnectionSource<TConfig extends object>(
    provider: DatabaseProviderServices<TConfig>,
    config: DatabaseProviderConnectionConfig<TConfig>,
): DatabaseConnectionSource {
    const created: unknown = provider.createDataSource?.(config);
    assertSynchronousCallbackResult(
        created,
        `Database provider '${provider.name}' data-source factory`,
        message => new TypeError(message),
    );
    return created as DatabaseConnectionSource | undefined ?? {
        createConnection: () => provider.createConnection(config),
    };
}

export function createDataSourceConnectionLease(
    providerName: string,
    source: DatabaseConnectionSource,
    release: () => void,
): DatabaseConnection {
    const created: unknown = source.createConnection();
    assertSynchronousCallbackResult(
        created,
        `Database data source '${providerName}' connection factory`,
        message => new TypeError(message),
    );
    return new DataSourceConnectionLease(created as DatabaseConnection, release);
}
