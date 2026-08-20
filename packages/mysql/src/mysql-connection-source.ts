import type { MySqlConnectionConfig } from '@entitykit/core';
import type { DatabaseConnectionSource } from '@entitykit/core/adapter';
import { createMysqlPool, type MySqlPool } from './mysql-driver';
import { createMysqlProviderError } from './mysql-provider-error';
import { MySqlPooledConnection } from './mysql-pooled-connection';

export class MySqlConnectionSource implements DatabaseConnectionSource {
    private readonly pool: MySqlPool;
    private readonly commandTimeoutMs?: number;

    constructor(config: string | MySqlConnectionConfig) {
        this.pool = createMysqlPool(config);
        this.commandTimeoutMs =
            typeof config === 'string' ? undefined : config.commandTimeoutMs;
    }

    public createConnection(): MySqlPooledConnection {
        return new MySqlPooledConnection(this.pool, this.commandTimeoutMs);
    }

    public async dispose(): Promise<void> {
        try {
            await this.pool.end();
        } catch (error) {
            throw createMysqlProviderError('dispose', error);
        }
    }
}
