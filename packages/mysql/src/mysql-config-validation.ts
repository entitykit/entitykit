import type { MySqlConnectionConfig } from '@entitykit/core';

export function validateMysqlConfig(config: MySqlConnectionConfig): void {
    if (config.connectionString !== undefined) {
        assertNonEmptyMysqlConnectionString(config.connectionString);
    }
    assertPort(config.port);
    assertBoolean('keepAlive', config.keepAlive);
    assertPositiveInteger('commandTimeoutMs', config.commandTimeoutMs);
    assertPositiveInteger('connectTimeoutMs', config.connectTimeoutMs);
    assertPositiveInteger(
        'keepAliveInitialDelayMs',
        config.keepAliveInitialDelayMs,
        true,
    );
    assertPositiveInteger('pool.max', config.pool?.max);
    assertPositiveInteger('pool.maxIdle', config.pool?.maxIdle, true);
    assertPositiveInteger('pool.idleTimeoutMs', config.pool?.idleTimeoutMs, true);
    assertPositiveInteger('pool.queueLimit', config.pool?.queueLimit, true);
    assertBoolean('pool.waitForConnections', config.pool?.waitForConnections);
    assertBoolean('pool.resetOnRelease', config.pool?.resetOnRelease);
    if (
        config.pool?.maxIdle !== undefined
        && config.pool.maxIdle > (config.pool.max ?? 10)
    ) {
        throw new Error('MySQL pool.maxIdle must not exceed pool.max.');
    }
    if (
        config.timezone !== undefined
        && !/^(?:local|Z|[+-]\d\d:\d\d)$/.test(config.timezone)
    ) {
        throw new Error(
            `MySQL timezone must be 'local', 'Z', or a signed HH:MM offset, received '${config.timezone}'.`,
        );
    }
    if ((config as { readonly ssl?: unknown }).ssl === true) {
        throw new Error(
            'MySQL ssl does not accept true; provide TLS options or a named SSL profile.',
        );
    }
}

export function assertNonEmptyMysqlConnectionString(value: string): void {
    if (value.trim().length === 0) {
        throw new Error('MySQL connection string must not be empty.');
    }
}

function assertPort(value: number | undefined): void {
    if (
        value !== undefined
        && (!Number.isInteger(value) || value < 1 || value > 65_535)
    ) {
        throw new Error(
            `MySQL port must be an integer between 1 and 65535, received ${String(value)}.`,
        );
    }
}

function assertPositiveInteger(
    name: string,
    value: number | undefined,
    allowZero = false,
): void {
    const minimum = allowZero ? 0 : 1;
    if (value !== undefined && (!Number.isInteger(value) || value < minimum)) {
        throw new Error(
            `MySQL ${name} must be an integer >= ${String(minimum)}, received ${String(value)}.`,
        );
    }
}

function assertBoolean(name: string, value: boolean | undefined): void {
    if (value !== undefined && typeof value !== 'boolean') {
        throw new Error(`MySQL ${name} must be a boolean, received ${String(value)}.`);
    }
}
