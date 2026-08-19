import path from 'path';
import type {
    DbContextConstructor,
    EntityKitCliContext,
    EntityKitConnectionOptions,
} from '../entity-kit-config';
import type { DatabaseProviderServices } from '../storage/database-provider-services';
import { validateProviderServices } from '../storage/database-provider-validation';
import { isEntityKitConfig, validatedNow, validateConfigValues } from './entity-kit-config-validation';
import { findEntityKitConfig, loadEntityKitConfigExport } from './entity-kit-config-loader';

/**
 * The definition API now lives in core so a project's `entitykit.config.ts` does
 * not depend on the CLI package. `entitykit/cli` keeps exposing it unchanged.
 */
export { defineEntityKitConfig } from '../entity-kit-config';
export type {
    DbContextConstructor,
    EntityKitCliContext,
    EntityKitConfig,
} from '../entity-kit-config';

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
