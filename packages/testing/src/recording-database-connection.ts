import type { DatabaseConnection, DatabaseOperationOptions, DatabaseQueryResult, QueryStreamOptions, TransactionOptions } from '../storage/database-connection';
import type { SqlStatement } from '../sql/sql-statement';
import type { RecordedDatabaseOperation } from './recorded-database-operation';
import { RecordingSession } from './recording-session';
import { RecordingTransaction } from './recording-transaction';
import { OperationCanceledError } from '../errors/runtime-errors';
import { queryStreamBatchSize } from '../storage/query-stream-options';
import { throwIfOperationAborted } from '../storage/operation-cancellation';

export type { RecordedDatabaseOperation } from './recorded-database-operation';

type QueuedQueryResult = DatabaseQueryResult | Error;

/** EntityKit implementation of recording database connection. */ export class RecordingDatabaseConnection implements DatabaseConnection {
    /** The statements. */ public readonly statements: SqlStatement[] = [];
    /** The operations. */ public readonly operations: RecordedDatabaseOperation[] = [];
    /** The transaction events. */ public readonly transactionEvents: string[] = [];
    /** The session events. */ public readonly sessionEvents: string[] = [];
    private readonly queuedResults: QueuedQueryResult[] = [];
    private readonly transactionState = new RecordingTransaction(this.operations, this.transactionEvents);
    private readonly sessionState = new RecordingSession(this.operations, this.sessionEvents);

    /** Whether in transaction. */ public get isInTransaction(): boolean {
        return this.transactionState.isActive;
    }

    /** Perform the queue result operation. */ public queueResult(result: Partial<DatabaseQueryResult> = {}): void {
        const normalized = {
            rows: result.rows ?? [],
            rowCount: result.rowCount ?? result.rows?.length ?? 0,
        };
        this.queuedResults.push(result.insertId === undefined
            ? normalized
            : { ...normalized, insertId: result.insertId });
    }

    /** Perform the queue error operation. */ public queueError(error: Error): void {
        this.queuedResults.push(error);
    }

    /** Perform the fail next transaction begin operation. */ public failNextTransactionBegin(error: Error): void {
        this.transactionState.failNextBegin(error);
    }

    /** Perform the fail next transaction commit operation. */ public failNextTransactionCommit(error: Error): void {
        this.transactionState.failNextCommit(error);
    }

    /** Perform the fail next transaction rollback operation. */ public failNextTransactionRollback(error: Error): void {
        this.transactionState.failNextRollback(error);
    }

    /** Perform the fail next savepoint operation. */ public failNextSavepoint(error: Error): void {
        this.transactionState.failNextSavepoint(error);
    }

    /** Perform the fail next release operation. */ public failNextRelease(error: Error): void {
        this.transactionState.failNextRelease(error);
    }

    /** Perform the fail next rollback to savepoint operation. */ public failNextRollbackToSavepoint(error: Error): void {
        this.transactionState.failNextRollbackToSavepoint(error);
    }

    /** Perform the query operation. */ public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        throwIfOperationAborted(options?.signal);
        this.statements.push({ text: statement.text, values: [...statement.values] });
        this.operations.push({ kind: 'query', statement: { text: statement.text, values: [...statement.values] } });
        const result = this.queuedResults.shift() ?? { rows: [], rowCount: 0 };
        if (result instanceof Error) {
            return Promise.reject(result);
        }
        const resolved = await Promise.resolve(result as DatabaseQueryResult<TRow>);
        throwIfOperationAborted(options?.signal);
        return resolved;
    }

    /** Stream one queued result row at a time. */
    public async *stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncGenerator<TRow> {
        await Promise.resolve();
        queryStreamBatchSize(options);
        this.statements.push({
            text: statement.text,
            values: [...statement.values],
        });
        this.operations.push({
            kind: 'stream',
            statement: {
                text: statement.text,
                values: [...statement.values],
            },
        });
        const queued = this.queuedResults.shift()
            ?? { rows: [], rowCount: 0 };
        if (queued instanceof Error) {
            throw queued;
        }
        for (const row of queued.rows as TRow[]) {
            if (options?.signal?.aborted) {
                throw new OperationCanceledError(options.signal.reason);
            }
            yield row;
        }
    }

    /** Perform the transaction operation. */ public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        return this.transactionState.run(work, options);
    }

    /** Run work in one recorded provider session. */
    public async session<TResult>(work: () => TResult | Promise<TResult>, options?: DatabaseOperationOptions): Promise<TResult> {
        throwIfOperationAborted(options?.signal);
        return this.sessionState.run(work);
    }
}
