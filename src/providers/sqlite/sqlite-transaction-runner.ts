/** SQLite root transactions, scoped options, and nested savepoints. */
import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
    type DatabaseProviderOperation,
} from '../../storage/database-errors';
import { EnclosingTransactionState } from '../../storage/enclosing-transaction-state';
import { sqliteError } from './sqlite-error';
import type { TransactionOptions } from '../../storage/database-connection';
import { validateTransactionOptions } from '../../storage/transaction-options';
import {
    applySqliteTransactionOptions,
    validateSqliteTransactionOptions,
} from './sqlite-transaction-options';
import { throwIfOperationAborted } from '../../storage/operation-cancellation';

export class SqliteTransactionRunner {
    private transactionDepth = 0;
    private readonly transactionState = new EnclosingTransactionState();

    /**
   * @param exec Runs a transaction-control statement (`begin`, `commit`,
   * `savepoint …`) on the connection's single handle, wrapping any driver
   * failure as a provider error under the given operation.
   */
    constructor(private readonly exec: (sql: string, operation: DatabaseProviderOperation) => void) {}

    public get isInTransaction(): boolean {
        return this.transactionDepth > 0;
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        validateTransactionOptions(options);
        if (this.isInTransaction) {
            if (options && (options.isolationLevel !== undefined || options.readOnly !== undefined)) {
                throw new Error('Nested SQLite transactions cannot change transaction options.');
            }
            return this.nestedTransaction(work, options);
        }
        validateSqliteTransactionOptions(options);
        throwIfOperationAborted(options?.signal);
        this.transactionDepth += 1;
        this.transactionState.reset();
        let started = false;
        const resets: Array<() => void> = [];
        let outcome: { value: TResult } | { error: unknown };

        try {
            applySqliteTransactionOptions(options, resets, this.exec);
            this.exec('begin', 'begin');
            started = true;
            throwIfOperationAborted(options?.signal);
            const result = await this.transactionState.runRootWork('SQLite', work);
            throwIfOperationAborted(options?.signal);
            this.exec('commit', 'commit');
            started = false;
            outcome = { value: result };
        } catch (error) {
            let failure = error;
            if (started) {
                try {
                    this.exec('rollback', 'rollback');
                } catch (rollbackError) {
                    failure = new DatabaseTransactionCleanupError(
                        'sqlite',
                        error,
                        rollbackError instanceof DatabaseProviderError
                            ? rollbackError
                            : sqliteError('rollback', rollbackError),
                    );
                }
            }
            outcome = { error: failure };
        }
        this.transactionDepth -= 1;
        this.transactionState.reset();
        try {
            for (const reset of resets.reverse()) {
                reset();
            }
        } catch (resetError) {
            if ('error' in outcome) {
                const cleanup = resetError instanceof DatabaseProviderError
                    ? resetError
                    : sqliteError('rollback', resetError);
                throw new DatabaseTransactionCleanupError('sqlite', outcome.error, cleanup);
            }
            throw resetError;
        }
        if ('error' in outcome) {
            throw outcome.error;
        }
        return outcome.value;
    }
    private async nestedTransaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        const savepoint = `entitykit_sp_${String(this.transactionDepth)}`;
        this.transactionDepth += 1;
        try {
            try {
                return await this.runSavepoint(savepoint, work, options);
            } catch (error) {
                this.transactionState.observeNestedFailure(error);
                throw error;
            }
        } finally {
            this.transactionDepth -= 1;
        }
    }
    private async runSavepoint<TResult>(
        savepoint: string,
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        throwIfOperationAborted(options?.signal);
        try {
            this.exec(`savepoint ${savepoint}`, 'savepoint');
        } catch (error) {
            this.transactionState.markUnusable(error);
            throw error;
        }
        throwIfOperationAborted(options?.signal);
        try {
            const result = await work();
            throwIfOperationAborted(options?.signal);
            this.exec(`release savepoint ${savepoint}`, 'releaseSavepoint');
            return result;
        } catch (error) {
            try {
                this.exec(`rollback to savepoint ${savepoint}`, 'rollbackToSavepoint');
                this.transactionState.markRecovered(error);
            } catch (rollbackError) {
                const cleanup = rollbackError instanceof DatabaseProviderError
                    ? rollbackError
                    : sqliteError('rollbackToSavepoint', rollbackError);
                throw new DatabaseTransactionCleanupError('sqlite', error, cleanup);
            }
            throw error;
        }
    }
}
