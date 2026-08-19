import type { SqlStatement } from '../sql/sql-statement';

/** Result produced by database query. */ export interface DatabaseQueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> {
    /** Rows returned by the database. */ readonly rows: TRow[];
    /** Number of rows affected or returned. */ readonly rowCount: number;
    /**
     * Provider-reported identity for an insert that cannot return rows.
     *
     * MySQL exposes this through its OK packet. Providers with `returning`
     * normally leave it undefined.
     */
    readonly insertId?: unknown;
}

/** Options shared by cancelable database operations. */
export interface DatabaseOperationOptions {
    /** Requests cancellation of the operation. */
    readonly signal?: AbortSignal;
}

/** Options for a bounded, cancelable database row stream. */
export interface QueryStreamOptions extends DatabaseOperationOptions {
    /** Maximum number of rows fetched or buffered by the provider at once. */
    readonly batchSize?: number;
}

/** Public type representing transaction isolation level. */ export type TransactionIsolationLevel =
    | 'readUncommitted'
    | 'readCommitted'
    | 'repeatableRead'
    | 'serializable';

/** Options that configure transaction. */ export interface TransactionOptions extends DatabaseOperationOptions {
    /** The isolation level. */ readonly isolationLevel?: TransactionIsolationLevel;
    /** The read only. */ readonly readOnly?: boolean;
}

/** Public contract for database connection. */ export interface DatabaseConnection {
    /** Whether in transaction. */ readonly isInTransaction: boolean;

    /** Perform the query operation. */ query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>>;

    /**
     * Stream rows with provider backpressure instead of buffering the complete
     * result. Providers may omit this optional capability.
     */
    stream?<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncIterable<TRow>;

    /** Perform the transaction operation. */ transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions
    ): Promise<TResult>;

    /**
   * Run work on a single provider session/connection without implicitly
   * starting a transaction. Providers that support pooling should use this
   * for session-scoped operations such as PostgreSQL advisory locks.
   */
    session?<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult>;

    /** Release resources owned by this object. */ dispose?(): Promise<void>;
}
