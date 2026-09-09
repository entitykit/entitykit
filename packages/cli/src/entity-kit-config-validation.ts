import type { DbContext } from '@entitykit/core';
import type { DatabaseProviderServices } from '@entitykit/core/adapter';
import type { EntityKitConfig } from './entity-kit-config';
import { readSynchronousDate } from '@entitykit/core/tooling';

type LoadedEntityKitConfig =
    Omit<EntityKitConfig<DbContext, Record<string, unknown>>, 'provider'> & {
        readonly provider?: DatabaseProviderServices<Record<string, unknown>>;
    };
type ValidatedEntityKitConfig = LoadedEntityKitConfig & {
    readonly provider: DatabaseProviderServices<Record<string, unknown>>;
};

export function isEntityKitConfig(
    value: unknown,
): value is LoadedEntityKitConfig {
    if (value === null || typeof value !== 'object' || !('context' in value)) {
        return false;
    }
    const context: unknown = value.context;
    return context !== null
        && (typeof context === 'object' || typeof context === 'function')
        && 'create' in context
        && typeof context.create === 'function';
}

export function validateConfigValues(
    config: LoadedEntityKitConfig,
    configPath: string,
): asserts config is ValidatedEntityKitConfig {
    assertOptionalNonEmptyString(config, 'migrationsDir', configPath);
    assertOptionalNonEmptyString(config, 'snapshot', configPath);
    if (!config.provider) {
        throw new Error(
            `EntityKit config '${configPath}' must specify provider services from @entitykit/postgres, @entitykit/sqlite, or @entitykit/mysql.`,
        );
    }
    if (config.now !== undefined && typeof config.now !== 'function') {
        throw new Error(`EntityKit config '${configPath}' now must be a function.`);
    }
    if (
        config.connection !== undefined
        && typeof config.connection !== 'function'
        && !isConnectionValue(config.connection)
    ) {
        throw new Error(
            `EntityKit config '${configPath}' connection must be a string, object, or callback.`,
        );
    }
    if (
        config.connectionString !== undefined
        && typeof config.connectionString !== 'string'
        && typeof config.connectionString !== 'function'
    ) {
        throw new Error(
            `EntityKit config '${configPath}' connectionString must be a string or callback.`,
        );
    }
}

export function validatedNow(
    configured: () => Date,
    configPath: string,
): () => Date {
    return () => {
        const value = readSynchronousDate(
            configured,
            `EntityKit config '${configPath}' now`,
        );
        if (!value || Number.isNaN(value.getTime())) {
            throw new Error(
                `EntityKit config '${configPath}' now must return a valid Date.`,
            );
        }
        return value;
    };
}

function assertOptionalNonEmptyString(
    config: LoadedEntityKitConfig,
    property: 'migrationsDir' | 'snapshot',
    configPath: string,
): void {
    const value = config[property];
    if (
        value !== undefined
        && (typeof value !== 'string' || value.trim().length === 0)
    ) {
        throw new Error(
            `EntityKit config '${configPath}' ${property} must be a non-empty string.`,
        );
    }
}

function isConnectionValue(value: unknown): value is string | object {
    return typeof value === 'string'
        || value !== null && typeof value === 'object';
}
