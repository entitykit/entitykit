import type { BuiltInConnectionConfig, EntityKitConnectionOptions } from '../entity-kit-config';
import type { DatabaseProviderConnectionConfig } from '../storage/database-provider-services';

/**
 * `connection` and `connectionString` are written in a project's config file, so
 * their shapes ship with the definition API in core. Resolving them — reading
 * callbacks, falling back to `DATABASE_URL`, validating — is CLI behaviour and
 * stays here.
 */
export type { BuiltInConnectionConfig, EntityKitConnectionOptions } from '../entity-kit-config';

/** Public type representing entity kit cli connection. */ export type EntityKitCliConnection =
    DatabaseProviderConnectionConfig<BuiltInConnectionConfig>;

/** Resolve entity kit connection. */ export async function resolveEntityKitConnection<TConfig extends object>(
    config: EntityKitConnectionOptions<TConfig>,
): Promise<DatabaseProviderConnectionConfig<TConfig> | undefined> {
    const configured = typeof config.connection === 'function'
        ? await config.connection()
        : config.connection;
    if (configured !== undefined) {
        return validateConnection<TConfig>(configured, 'connection');
    }
    const legacy = typeof config.connectionString === 'function'
        ? await config.connectionString()
        : config.connectionString;
    const fallback = legacy ?? process.env.DATABASE_URL;
    return fallback === undefined
        ? undefined
        : validateConnection<TConfig>(
            fallback,
            legacy === undefined ? 'DATABASE_URL' : 'connectionString',
        );
}

function validateConnection<TConfig extends object>(
    value: unknown,
    source: 'connection' | 'connectionString' | 'DATABASE_URL',
): DatabaseProviderConnectionConfig<TConfig> {
    if (typeof value === 'string') {
        if (value.trim().length === 0) {
            throw new Error(`EntityKit ${source} must not be empty.`);
        }
        return value;
    }
    if (value !== null && typeof value === 'object') {
        return value as TConfig;
    }
    throw new Error(
        `EntityKit ${source} must resolve to a connection string or configuration object.`,
    );
}
