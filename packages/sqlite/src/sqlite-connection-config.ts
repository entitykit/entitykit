import type { SqliteConnectionConfig } from '../../storage/built-in-provider-config';

/** Default lock wait used instead of SQLite's fail-immediately default. */
export const defaultSqliteBusyTimeoutMs = 5000;

export interface ResolvedSqliteConnectionConfig {
    readonly filename: string;
    readonly options: SqliteConnectionConfig;
    readonly busyTimeoutMs: number;
}

export function resolveSqliteConnectionConfig(
    config: string | SqliteConnectionConfig,
): ResolvedSqliteConnectionConfig {
    validateAliases(config);
    const options: SqliteConnectionConfig =
        typeof config === 'string' ? {} : config;
    const filename = typeof config === 'string'
        ? config
        : config.filename ?? config.connectionString ?? ':memory:';
    if (filename.trim().length === 0) {
        throw new Error('SQLite database filename must not be empty.');
    }
    assertBoolean('readOnly', options.readOnly);
    assertBoolean('foreignKeys', options.foreignKeys);
    const busyTimeoutMs = options.busyTimeoutMs ?? defaultSqliteBusyTimeoutMs;
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
        throw new Error(
            `SQLite busyTimeoutMs must be a non-negative integer, received ${String(busyTimeoutMs)}.`,
        );
    }
    if (
        options.journalMode !== undefined
        && !/^[A-Za-z]+$/.test(options.journalMode)
    ) {
        throw new Error(
            `SQLite journalMode must be a bare mode name, received '${options.journalMode}'.`,
        );
    }
    return { filename, options, busyTimeoutMs };
}

function validateAliases(config: string | SqliteConnectionConfig): void {
    if (
        typeof config !== 'string'
        && config.filename !== undefined
        && config.connectionString !== undefined
    ) {
        throw new Error(
            'SQLite configuration must use filename or connectionString, not both.',
        );
    }
}

function assertBoolean(name: string, value: boolean | undefined): void {
    if (value !== undefined && typeof value !== 'boolean') {
        throw new Error(`SQLite ${name} must be a boolean.`);
    }
}
