import type { DatabaseConnectionSource } from '../../storage/database-data-source';
import type { PostgresConnectionConfig } from '../../storage/built-in-provider-config';
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
