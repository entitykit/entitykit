import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    SqlStatement,
    TransactionOptions,
} from '../../src';
import { OperationCanceledError } from '../../src';

type QueuedQueryResult = DatabaseQueryResult | Error;

export class RecordingDatabaseConnection implements DatabaseConnection {
    public readonly statements: SqlStatement[] = [];
    public readonly transactionEvents: string[] = [];
    public readonly transactionOptions: Array<TransactionOptions | undefined> = [];
    public readonly sessionEvents: string[] = [];
    private queuedResults: QueuedQueryResult[] = [];
    private nextTransactionBeginError?: Error;
    private nextTransactionCommitError?: Error;
    private nextTransactionRollbackError?: Error;
    private nextSavepointError?: Error;
    private nextReleaseError?: Error;
    private nextRollbackToSavepointError?: Error;
    private transactionDepth = 0;
    private sessionDepth = 0;

    public get isInTransaction(): boolean {
        return this.transactionDepth > 0;
    }

    public queueResult(result: Partial<DatabaseQueryResult> = {}): void {
        const normalized = {
            rows: result.rows ?? [],
            rowCount: result.rowCount ?? result.rows?.length ?? 0,
        };
        this.queuedResults.push(result.insertId === undefined
            ? normalized
            : { ...normalized, insertId: result.insertId });
    }

    public queueError(error: Error): void {
        this.queuedResults.push(error);
    }

    public failNextTransactionBegin(error: Error): void {
        this.nextTransactionBeginError = error;
    }

    public failNextTransactionCommit(error: Error): void {
        this.nextTransactionCommitError = error;
    }

    public failNextTransactionRollback(error: Error): void {
        this.nextTransactionRollbackError = error;
    }

    public failNextSavepoint(error: Error): void {
        this.nextSavepointError = error;
    }

    public failNextRelease(error: Error): void {
        this.nextReleaseError = error;
    }

    public failNextRollbackToSavepoint(error: Error): void {
        this.nextRollbackToSavepointError = error;
    }

    public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        if (options?.signal?.aborted) {
            throw new OperationCanceledError(options.signal.reason);
        }
        this.statements.push(statement);
        const result = this.queuedResults.shift() ?? { rows: [], rowCount: 0 };
        if (result instanceof Error) {
            return Promise.reject(result);
        }
        return Promise.resolve(result as DatabaseQueryResult<TRow>);
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        this.transactionOptions.push(options);
        if (this.isInTransaction) {
            const savepointName = `entitykit_sp_${String(this.transactionDepth)}`;
            this.transactionDepth += 1;
            this.transactionEvents.push(`savepoint:${savepointName}`);
            if (this.nextSavepointError) {
                const error = this.nextSavepointError;
                this.nextSavepointError = undefined;
                this.transactionDepth -= 1;
                throw error;
            }

            try {
                const result = await work();
                if (this.nextReleaseError) {
                    const error = this.nextReleaseError;
                    this.nextReleaseError = undefined;
                    throw error;
                }
                this.transactionEvents.push(`release:${savepointName}`);
                return result;
            } catch (error) {
                if (this.nextRollbackToSavepointError) {
                    const rollbackError = this.nextRollbackToSavepointError;
                    this.nextRollbackToSavepointError = undefined;
                    throw rollbackError;
                }
                this.transactionEvents.push(`rollback-to:${savepointName}`);
                throw error;
            } finally {
                this.transactionDepth -= 1;
            }
        }

        this.transactionDepth += 1;
        this.transactionEvents.push('begin');
        if (this.nextTransactionBeginError) {
            const error = this.nextTransactionBeginError;
            this.nextTransactionBeginError = undefined;
            this.transactionDepth -= 1;
            throw error;
        }

        try {
            const result = await work();
            if (this.nextTransactionCommitError) {
                const error = this.nextTransactionCommitError;
                this.nextTransactionCommitError = undefined;
                throw error;
            }
            this.transactionEvents.push('commit');
            return result;
        } catch (error) {
            if (this.nextTransactionRollbackError) {
                const rollbackError = this.nextTransactionRollbackError;
                this.nextTransactionRollbackError = undefined;
                throw rollbackError;
            }
            this.transactionEvents.push('rollback');
            throw error;
        } finally {
            this.transactionDepth -= 1;
        }
    }

    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        if (options?.signal?.aborted) {
            throw new OperationCanceledError(options.signal.reason);
        }
        if (this.sessionDepth > 0) {
            return work();
        }

        this.sessionDepth += 1;
        this.sessionEvents.push('start');

        try {
            return await work();
        } finally {
            this.sessionEvents.push('end');
            this.sessionDepth -= 1;
        }
    }
}
