import path from 'path';
import type { MigrationContext } from '../migrations/context-migrations';
import type { DatabaseProviderServices } from '../storage/database-provider-services';
import { validateProviderServices } from '../storage/database-provider-validation';
import type { EntityKitConnectionOptions } from './entity-kit-connection-config';
import { isEntityKitConfig, validatedNow, validateConfigValues } from './entity-kit-config-validation';
import { findEntityKitConfig, loadEntityKitConfigExport } from './entity-kit-config-loader';
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
/** Configuration for resolved entity kit. */ export interface ResolvedEntityKitConfig<
    TContext extends EntityKitCliContext = EntityKitCliContext,
    TConfig extends object = Record<string, unknown>,
> extends EntityKitConnectionOptions<TConfig> {
    /** The context. */ readonly context: DbContextConstructor<TContext>;
    /** The migrations dir. */ readonly migrationsDir: string;
    /** The snapshot. */ readonly snapshot: string;
    /** Name of the configured database provider. */ readonly provider: DatabaseProviderServices<TConfig>;
    /** The config path. */ readonly configPath?: string;
    /** The project root. */ readonly projectRoot: string;
    /** The now. */ readonly now: () => Date;
}
/** Options that configure entity kit config load. */ export interface EntityKitConfigLoadOptions {
    /** The cwd. */ readonly cwd?: string;
    /** The config path. */ readonly configPath?: string;
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

/** Perform the load entity kit config operation. */ export async function loadEntityKitConfig(options: EntityKitConfigLoadOptions = {}): Promise<ResolvedEntityKitConfig> {
    const discoveryRoot = path.resolve(options.cwd ?? process.cwd());
    const configPath = options.configPath
        ? path.resolve(discoveryRoot, options.configPath)
        : findEntityKitConfig(discoveryRoot);

    if (!configPath) {
        throw new Error(`Could not find an EntityKit config file from '${discoveryRoot}'. Create entitykit.config.ts or pass --config <path>.`);
    }

    const config = await loadEntityKitConfigExport(configPath);
    if (!isEntityKitConfig(config)) {
        throw new Error(`EntityKit config '${configPath}' must export a context class with a static create() method.`);
    }
    validateConfigValues(config, configPath);

    const projectRoot = path.dirname(configPath);
    const migrationsDir = path.resolve(projectRoot, config.migrationsDir ?? 'src/db/migrations');
    const snapshot = path.resolve(projectRoot, config.snapshot ?? path.join(config.migrationsDir ?? 'src/db/migrations', 'EntityKitModelSnapshot.ts'));
    const provider = config.provider;
    validateProviderServices(provider);
    const now = validatedNow(config.now ?? (() => new Date()), configPath);

    return {
        context: config.context,
        migrationsDir,
        snapshot,
        provider,
        connection: config.connection,
        connectionString: config.connectionString,
        configPath,
        projectRoot,
        now,
    };
}
