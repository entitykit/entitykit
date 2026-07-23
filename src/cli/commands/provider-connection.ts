import type { MigrationHistoryRow } from '../../migrations/migration-history';
import { MigrationRunner } from '../../migrations/migration-runner';
import {
    type ResolvedEntityKitConfig,
} from '../entity-kit-config';
import { resolveEntityKitConnection } from '../entity-kit-connection-config';
import type {
    DatabaseProviderConnectionConfig,
    DatabaseProviderServices,
} from '../../storage/database-provider-services';

type ConnectionConfig = Pick<
    ResolvedEntityKitConfig,
    'connection' | 'connectionString' | 'provider'
>;
type ConnectionProvider<TConfig extends object> =
    Pick<DatabaseProviderServices<TConfig>, 'name' | 'createConnection'>;

/** Read migration history when the command has a database target. */
export async function readAppliedMigrationHistory(
    config: ConnectionConfig,
    signal?: AbortSignal,
): Promise<readonly MigrationHistoryRow[] | undefined> {
    const target = await resolveEntityKitConnection(config);
    if (!target) {
        return undefined;
    }

    const connection = createDatabaseConnection(config.provider, target);
    try {
        return await new MigrationRunner(
            connection,
            config.provider.migrationDialect,
            config.provider.createMigrationBuilder,
        ).getAppliedMigrations({ signal, initializeHistory: false });
    } finally {
        await connection.dispose?.();
    }
}

/** Create a provider connection with command-oriented configuration guidance. */
export function createDatabaseConnection<TConfig extends object>(
    provider: ConnectionProvider<TConfig>,
    connection: DatabaseProviderConnectionConfig<TConfig>,
): ReturnType<ConnectionProvider<TConfig>['createConnection']> {
    try {
        return provider.createConnection(connection);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Failed to create database connection for provider '${provider.name}'. ` +
            `Check connection, connectionString, or DATABASE_URL. ${reason}`,
            { cause: error },
        );
    }
}
