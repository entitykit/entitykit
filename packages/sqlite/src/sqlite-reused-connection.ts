import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    SqlStatement,
    TransactionOptions,
} from '@entitykit/core/adapter';
import type { SqliteDatabaseConnection } from './sqlite-database-connection';
import { hasMultipleStatements } from './sqlite-statement';

/** One exclusive lease; session-changing SQL and failed work retire its handle. */
export class SqliteReusedConnection implements DatabaseConnection {
    private reusable = true;
    private disposed = false;
    private disposal?: Promise<void>;

    constructor(
        private readonly inner: SqliteDatabaseConnection,
        private readonly release: (connection: SqliteDatabaseConnection, reusable: boolean) => Promise<void>,
    ) {}

    public get isInTransaction(): boolean {
        return !this.disposed && this.inner.isInTransaction;
    }

    public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.assertActive();
        const captured = this.captureStatement(statement);
        return this.run(async () => this.inner.query<TRow>(captured, options));
    }

    public async *stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncGenerator<TRow> {
        this.assertActive();
        const captured = this.captureStatement(statement);
        try {
            yield* this.inner.stream<TRow>(captured, options);
        } catch (error) {
            this.reusable = false;
            throw error;
        }
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        return this.run(async () => this.inner.transaction(work, options));
    }

    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        return this.run(async () => this.inner.session(work, options));
    }

    public async dispose(): Promise<void> {
        if (!this.disposed) {
            this.disposed = true;
            this.disposal = this.release(this.inner, this.reusable && !this.inner.isInTransaction);
        }
        await this.disposal;
    }

    private async run<TResult>(work: () => Promise<TResult>): Promise<TResult> {
        this.assertActive();
        try {
            return await work();
        } catch (error) {
            this.reusable = false;
            throw error;
        }
    }

    private captureStatement(statement: SqlStatement): SqlStatement {
        const captured: SqlStatement = {
            text: statement.text,
            values: statement.values,
            suppressTransaction: statement.suppressTransaction,
        };
        // PRAGMAs, DDL, raw transaction control and scripts can change connection
        // state. Do not attempt to infer or undo those effects across leases.
        // EXPLAIN also retires: some PRAGMAs take effect during preparation,
        // even with EXPLAIN or EXPLAIN QUERY PLAN prefixed to the statement.
        // Execute the same captured text that was classified, including when
        // the caller supplied a getter or proxy rather than an ordinary record.
        if (!/^\s*(select|insert|update|delete|replace|with|values)\b/i.test(captured.text)
            || hasMultipleStatements(captured.text)) {
            this.reusable = false;
        }
        return captured;
    }

    private assertActive(): void {
        if (this.disposed) throw new Error('The SQLite connection lease was disposed.');
    }
}
