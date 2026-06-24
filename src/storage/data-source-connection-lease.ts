import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionOptions,
} from './database-connection';
import type { SqlStatement } from '../sql/sql-statement';
import { GuardedDatabaseConnection } from './guarded-database-connection';

export class DataSourceConnectionLease implements DatabaseConnection {
    private readonly inner: GuardedDatabaseConnection;
    private disposed = false;

    constructor(
        inner: DatabaseConnection,
        private readonly release: () => void,
    ) {
        this.inner = new GuardedDatabaseConnection(inner);
    }

    public get isInTransaction(): boolean {
        return this.inner.isInTransaction;
    }

    public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.assertActive();
        return await this.inner.query<TRow>(statement, options);
    }

    public stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncIterable<TRow> {
        this.assertActive();
        return this.streamRows<TRow>(statement, options);
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        this.assertActive();
        return await this.inner.transaction(work, options);
    }

    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        this.assertActive();
        return await this.inner.session(work, options);
    }

    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (this.inner.isOperationInProgress) {
            throw new Error(
                'Cannot dispose a data-source connection lease while a database operation is active. Await the operation first.',
            );
        }
        this.disposed = true;
        try {
            await this.inner.dispose();
        } finally {
            this.release();
        }
    }

    private assertActive(): void {
        if (this.disposed) {
            throw new Error('The data-source connection lease was disposed.');
        }
    }

    private async *streamRows<TRow extends Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncGenerator<TRow> {
        this.assertActive();
        yield* this.inner.stream<TRow>(statement, options);
    }
}
