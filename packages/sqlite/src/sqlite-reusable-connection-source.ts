import type { DatabaseConnection, DatabaseConnectionSource } from '@entitykit/core/adapter';
import type { SqliteConnectionConfig } from '@entitykit/core';
import { resolveSqliteConnectionConfig } from './sqlite-connection-config';
import { SqliteDatabaseConnection } from './sqlite-database-connection';
import { SqliteReusedConnection } from './sqlite-reused-connection';

/** Bounded idle retention; every live lease exclusively owns a native handle. */
export class SqliteReusableConnectionSource implements DatabaseConnectionSource {
    private readonly config: string | SqliteConnectionConfig;
    private readonly idle: SqliteDatabaseConnection[] = [];
    private active = 0;
    private disposed = false;
    private disposal?: Promise<void>;

    constructor(config: string | SqliteConnectionConfig, private readonly maxIdleConnections: number) {
        this.config = typeof config === 'string' ? config : { ...config };
        const { filename } = resolveSqliteConnectionConfig(this.config);
        if (filename === ':memory:' || filename.startsWith('file:')) {
            throw new Error('SQLite connection reuse requires a filesystem path, not an in-memory database or file URI.');
        }
    }

    public createConnection(): DatabaseConnection {
        if (this.disposed) throw new Error('The SQLite connection source was disposed.');
        const connection = this.idle.pop() ?? new SqliteDatabaseConnection(this.config);
        this.active += 1;
        return new SqliteReusedConnection(connection, async (released, reusable) => {
            try {
                if (reusable && this.idle.length < this.maxIdleConnections) {
                    this.idle.push(released);
                } else {
                    await released.dispose();
                }
            } finally {
                this.active -= 1;
            }
        });
    }

    public async dispose(): Promise<void> {
        if (this.active > 0) throw new Error('Cannot dispose a SQLite connection source with active leases.');
        if (!this.disposed) {
            this.disposed = true;
            this.disposal = this.closeIdle();
        }
        await this.disposal;
    }

    private async closeIdle(): Promise<void> {
        const results = await Promise.allSettled(this.idle.splice(0).map(async connection => connection.dispose()));
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
    }
}
