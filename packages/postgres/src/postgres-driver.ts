import type { PostgresConnectionConfig } from '@entitykit/core';
import { observePostgresPoolErrors } from './postgres-pool-errors';
import type { PgModule, Pool } from './postgres-driver-contract';

export type {
    Pool,
    PoolClient,
    PostgresQueryResult,
} from './postgres-driver-contract';

export type { PostgresConnectionConfig } from '@entitykit/core';

export function createPostgresPool(
    config: string | PostgresConnectionConfig,
): Pool {
    const { Pool } = requirePg();
    if (typeof config === 'string') {
        assertNonEmptyConnectionString(config);
        return observePostgresPoolErrors(new Pool({ connectionString: config }));
    }
    validatePostgresConfig(config);
    const {
        driverOptions,
        pool,
        commandTimeoutMs,
        applicationName,
        keepAliveInitialDelayMs,
        lockTimeoutMs,
        idleInTransactionTimeoutMs,
        ...connection
    } = config;
    const created = new Pool({
        ...driverOptions,
        ...definedOptions({
            ...connection,
            application_name: applicationName,
            statement_timeout: commandTimeoutMs,
            lock_timeout: lockTimeoutMs,
            idle_in_transaction_session_timeout: idleInTransactionTimeoutMs,
            keepAliveInitialDelayMillis: keepAliveInitialDelayMs,
            min: pool?.min,
            max: pool?.max,
            idleTimeoutMillis: pool?.idleTimeoutMs,
            connectionTimeoutMillis: pool?.connectionTimeoutMs,
            maxLifetimeSeconds: pool?.maxLifetimeSeconds,
            maxUses: pool?.maxUses,
            allowExitOnIdle: pool?.allowExitOnIdle,
        }),
    });
    return observePostgresPoolErrors(created, pool?.onError);
}

function definedOptions(options: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
    );
}

function validatePostgresConfig(config: PostgresConnectionConfig): void {
    if (config.connectionString !== undefined) {
        assertNonEmptyConnectionString(config.connectionString);
    }
    assertPort(config.port);
    assertBoolean('keepAlive', config.keepAlive);
    assertPositiveInteger('commandTimeoutMs', config.commandTimeoutMs);
    assertPositiveInteger('lockTimeoutMs', config.lockTimeoutMs);
    assertPositiveInteger(
        'idleInTransactionTimeoutMs',
        config.idleInTransactionTimeoutMs,
    );
    assertPositiveInteger(
        'keepAliveInitialDelayMs',
        config.keepAliveInitialDelayMs,
        true,
    );
    assertPositiveInteger('pool.min', config.pool?.min, true);
    assertPositiveInteger('pool.max', config.pool?.max);
    assertPositiveInteger('pool.idleTimeoutMs', config.pool?.idleTimeoutMs, true);
    assertPositiveInteger('pool.connectionTimeoutMs', config.pool?.connectionTimeoutMs, true);
    assertPositiveInteger('pool.maxLifetimeSeconds', config.pool?.maxLifetimeSeconds, true);
    assertPositiveInteger('pool.maxUses', config.pool?.maxUses);
    assertBoolean('pool.allowExitOnIdle', config.pool?.allowExitOnIdle);
    if (
        config.pool?.onError !== undefined
        && typeof config.pool.onError !== 'function'
    ) {
        throw new Error('Postgres pool.onError must be a function.');
    }
    if (
        config.pool?.min !== undefined
        && config.pool.max !== undefined
        && config.pool.min > config.pool.max
    ) {
        throw new Error('Postgres pool.min must not exceed pool.max.');
    }
}

function assertPort(value: number | undefined): void {
    if (
        value !== undefined
        && (!Number.isInteger(value) || value < 1 || value > 65_535)
    ) {
        throw new Error(
            `Postgres port must be an integer between 1 and 65535, received ${String(value)}.`,
        );
    }
}

function assertNonEmptyConnectionString(value: string): void {
    if (value.trim().length === 0) {
        throw new Error('Postgres connection string must not be empty.');
    }
}

function assertPositiveInteger(name: string, value: number | undefined, allowZero = false): void {
    const minimum = allowZero ? 0 : 1;
    if (value !== undefined && (!Number.isInteger(value) || value < minimum)) {
        throw new Error(`Postgres ${name} must be an integer >= ${String(minimum)}, received ${String(value)}.`);
    }
}

function assertBoolean(name: string, value: boolean | undefined): void {
    if (value !== undefined && typeof value !== 'boolean') {
        throw new Error(`Postgres ${name} must be a boolean, received ${String(value)}.`);
    }
}

function requirePg(): PgModule {
    try {
        // A direct lazy require lets server bundlers externalize `pg` and lets
        // Node resolve the peer from the consuming application.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime peer dependency.
        return require('pg') as PgModule;
    } catch (error) {
        if (!isMissingModule(error, 'pg')) {
            throw error;
        }
        throw new Error(
            'The Postgres provider needs the \'pg\' peer dependency, which is not installed. ' +
      'Run `npm install pg` (and `npm install --save-dev @types/pg` for types).',
            { cause: error },
        );
    }
}

function isMissingModule(error: unknown, moduleId: string): boolean {
    const candidate = error as NodeJS.ErrnoException | undefined;
    return candidate?.code === 'MODULE_NOT_FOUND' && candidate.message.startsWith(`Cannot find module '${moduleId}'`);
}
