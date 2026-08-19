import type { PostgresConnectionConfig } from '../../storage/built-in-provider-config';
import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionOptions,
} from '../../storage/database-connection';
import type { SqlStatement } from '../../sql/sql-statement';
import type { PostgresPooledConnection } from './postgres-pooled-connection';
import { PostgresConnectionSource } from './postgres-connection-source';

export type { PostgresConnectionConfig } from '../../storage/built-in-provider-config';

/** Standalone Postgres connection that owns its pool. */
export class PostgresDatabaseConnection implements DatabaseConnection {
    private readonly source: PostgresConnectionSource;
    private readonly connection: PostgresPooledConnection;

    constructor(config: string | PostgresConnectionConfig) {
        this.source = new PostgresConnectionSource(config);
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

    /** Stream rows through a bounded PostgreSQL cursor. */
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

    /** Run work on one checked-out Postgres client. */
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
