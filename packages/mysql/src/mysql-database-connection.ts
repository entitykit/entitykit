import type { MySqlConnectionConfig } from '@entitykit/core';
import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionOptions,
} from '@entitykit/core/adapter';
import type { SqlStatement } from '@entitykit/core/adapter';
import type { MySqlPooledConnection } from './mysql-pooled-connection';
import { MySqlConnectionSource } from './mysql-connection-source';

export type { MySqlConnectionConfig } from '@entitykit/core';

/** Standalone MySQL connection that owns its pool. */
export class MySqlDatabaseConnection implements DatabaseConnection {
    private readonly source: MySqlConnectionSource;
    private readonly connection: MySqlPooledConnection;

    constructor(config: string | MySqlConnectionConfig) {
        this.source = new MySqlConnectionSource(config);
        this.connection = this.source.createConnection();
    }

    /** Whether in transaction. */ public get isInTransaction(): boolean {
        return this.connection.isInTransaction;
    }

    /** Perform the query operation. */ public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        return await this.connection.query<TRow>(statement, options);
    }

    /** Stream rows through mysql2's backpressured query stream. */
    public stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncIterable<TRow> {
        return this.connection.stream<TRow>(statement, options);
    }

    /** Perform the transaction operation. */ public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        return await this.connection.transaction(work, options);
    }

    /** Run work on one checked-out MySQL connection. */
    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        return await this.connection.session(work, options);
    }

    /** Release resources owned by this object. */ public async dispose(): Promise<void> {
        await this.source.dispose();
    }
}
