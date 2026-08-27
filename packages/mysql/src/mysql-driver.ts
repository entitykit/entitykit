import type { MySqlConnectionConfig } from '@entitykit/core';
import {
    assertNonEmptyMysqlConnectionString,
    validateMysqlConfig,
} from './mysql-config-validation';

// Structural types for the parts of `mysql2/promise` EntityKit uses, so this
// provider can compile without the peer dependency installed.
export interface MySqlQueryResult {
    readonly affectedRows?: number;
    readonly insertId?: number | string | bigint;
}

export interface MySqlConnection {
    query(
        sql: string | MySqlQueryOptions,
        values?: readonly unknown[]
    ): Promise<[unknown, unknown]>;
    readonly connection: MySqlCallbackConnection;
    release(): void;
    destroy(): void;
}

export interface MySqlCallbackConnection {
    query(
        sql: string | MySqlStreamQueryOptions,
        values?: readonly unknown[],
    ): MySqlStreamQuery;
}

export interface MySqlStreamQuery {
    once(event: 'end' | 'error', listener: (error?: unknown) => void): this;
    stream(options?: { readonly highWaterMark?: number }): MySqlReadable;
}

export interface MySqlReadable {
    iterator(options: {
        readonly destroyOnReturn: boolean;
    }): AsyncIterableIterator<unknown>;
    resume(): this;
}

export interface MySqlStreamQueryOptions {
    readonly sql: string;
    readonly values: readonly unknown[];
    readonly timeout?: number;
}

export interface MySqlPool {
    query(
        sql: string | MySqlQueryOptions,
        values?: readonly unknown[]
    ): Promise<[unknown, unknown]>;
    getConnection(): Promise<MySqlConnection>;
    end(): Promise<void>;
}

export interface MySqlQueryOptions {
    readonly sql: string;
    readonly values: readonly unknown[];
    readonly timeout: number;
}

interface MySql2Module {
    createPool(config: Record<string, unknown>): MySqlPool;
}

export type { MySqlConnectionConfig } from '@entitykit/core';

export function createMysqlPool(
    config: string | MySqlConnectionConfig,
): MySqlPool {
    const mysql2 = requireMysql2();
    if (typeof config === 'string') {
        assertNonEmptyMysqlConnectionString(config);
    } else {
        validateMysqlConfig(config);
    }
    const base = typeof config === 'string'
        ? { uri: config }
        : mysqlDriverConfig(config);

    return mysql2.createPool({
    // UTC so a DATETIME round-trips a JavaScript Date without a timezone
    // guess, and multi-statement so `createSchemaScript()` runs in one call.
        timezone: 'Z',
        ...base,
        multipleStatements: true,
    });
}

function mysqlDriverConfig(config: MySqlConnectionConfig): Record<string, unknown> {
    const uri = config.connectionString ? { uri: config.connectionString } : {};
    return {
        ...config.driverOptions,
        ...uri,
        ...definedOptions({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            ssl: config.ssl,
            charset: config.charset,
            timezone: config.timezone,
            enableKeepAlive: config.keepAlive,
            keepAliveInitialDelay: config.keepAliveInitialDelayMs,
            connectTimeout: config.connectTimeoutMs,
            connectionLimit: config.pool?.max,
            maxIdle: config.pool?.maxIdle,
            idleTimeout: config.pool?.idleTimeoutMs,
            queueLimit: config.pool?.queueLimit,
            waitForConnections: config.pool?.waitForConnections,
            resetOnRelease: config.pool?.resetOnRelease,
        }),
    };
}

function definedOptions(options: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
    );
}

function requireMysql2(): MySql2Module {
    try {
        // A direct lazy require lets server bundlers externalize `mysql2` and
        // lets Node resolve the peer from the consuming application.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime peer dependency.
        return require('mysql2/promise') as MySql2Module;
    } catch (error) {
        if (!isMissingModule(error, 'mysql2/promise')) {
            throw error;
        }
        throw new Error(
            'The MySQL provider needs the \'mysql2\' peer dependency, which is not installed. ' +
            'Run `npm install mysql2`.',
            { cause: error },
        );
    }
}

function isMissingModule(error: unknown, moduleId: string): boolean {
    const candidate = error as NodeJS.ErrnoException | undefined;
    return candidate?.code === 'MODULE_NOT_FOUND' && candidate.message.startsWith(`Cannot find module '${moduleId}'`);
}
