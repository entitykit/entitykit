import type { DatabaseConnectionSource } from '@entitykit/core/adapter';
import type { PostgresConnectionConfig } from '@entitykit/core';
import { createPostgresPool, type Pool } from './postgres-driver';
import { PostgresPooledConnection } from './postgres-pooled-connection';
import { createPostgresProviderError } from './postgres-provider-error';

export class PostgresConnectionSource implements DatabaseConnectionSource {
    private readonly pool: Pool;

    constructor(config: string | PostgresConnectionConfig) {
        this.pool = createPostgresPool(config);
    }

    public createConnection(): PostgresPooledConnection {
        return new PostgresPooledConnection(this.pool);
    }

    public async dispose(): Promise<void> {
        try {
            await this.pool.end();
        } catch (error) {
            throw createPostgresProviderError('dispose', error);
        }
    }
}
