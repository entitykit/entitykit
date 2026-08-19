import type { MigrationContext } from './migrations/context-migrations';
import type {
    MySqlConnectionConfig,
    PostgresConnectionConfig,
    SqliteConnectionConfig,
} from './storage/built-in-provider-config';
import type {
    DatabaseProviderConnectionConfig,
    DatabaseProviderServices,
} from './storage/database-provider-services';

/**
 * The `entitykit.config.ts` definition API.
 *
 * Every project's config file imports `defineEntityKitConfig`, so the module
 * that declares it is a runtime dependency of the config file itself. It lives
 * in core — not the CLI — so that a project can describe its context and
 * provider without installing the command-line package, and so the migration
 * file loader can resolve the `entitykit/cli` alias without core depending on
 * the CLI. The CLI re-exports everything here, keeping `entitykit/cli`
 * unchanged for existing config files.
 *
 * Config *loading* (discovery, validation, resolution) stays in the CLI: it is
 * a tool behaviour, not a contract a config file names.
 */

/** Connection shapes accepted by the built-in providers. */ export type BuiltInConnectionConfig =
    | MySqlConnectionConfig
    | PostgresConnectionConfig
    | SqliteConnectionConfig;

/** Options that configure entity kit connection. */ export interface EntityKitConnectionOptions<
    TConfig extends object = BuiltInConnectionConfig,
> {
    /** The connection. */ readonly connection?:
        | DatabaseProviderConnectionConfig<TConfig>
        | (() =>
            | DatabaseProviderConnectionConfig<TConfig>
            | undefined
            | Promise<DatabaseProviderConnectionConfig<TConfig> | undefined>);
    /** Legacy string-only alias; prefer `connection`. */
    readonly connectionString?:
        | string
        | (() => string | undefined | Promise<string | undefined>);
}

/** Minimal context lifecycle used by CLI database and migration commands. */
export interface EntityKitCliContext extends MigrationContext {
    /** Release resources owned by this object. */ dispose(): Promise<void>;
}

/** Public contract for db context constructor. */ export interface DbContextConstructor<
    TContext extends EntityKitCliContext = EntityKitCliContext,
> {
    /** Create and initialize an instance. */ create(): TContext;
}

/** Configuration for entity kit. */ export interface EntityKitConfig<
    TContext extends EntityKitCliContext = EntityKitCliContext,
    TConfig extends object = object,
> extends EntityKitConnectionOptions<TConfig> {
    /** The context. */ readonly context: DbContextConstructor<TContext>;
    /** The migrations dir. */ readonly migrationsDir?: string;
    /** The snapshot. */ readonly snapshot?: string;
    /** Provider used for migrations, connections, and schema introspection. */ readonly provider: DatabaseProviderServices<TConfig>;
    /** The now. */ readonly now?: () => Date;
}

/** Perform the define entity kit config operation. */ export function defineEntityKitConfig<
    TContext extends EntityKitCliContext,
    TConfig extends object,
>(
    config: EntityKitConfig<TContext, TConfig>,
): EntityKitConfig<TContext, TConfig>;
/** Perform the define entity kit config operation. */ export function defineEntityKitConfig<
    TContext extends EntityKitCliContext,
    TConfig extends object,
>(config: EntityKitConfig<TContext, TConfig>): EntityKitConfig<TContext, TConfig> {
    return config;
}
