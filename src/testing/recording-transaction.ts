import type { RecordedDatabaseOperation } from './recorded-database-operation';
import type { TransactionOptions } from '../storage/database-connection';
import { validateRecordingTransactionOptions } from './recording-transaction-options';
import { throwIfOperationAborted } from '../storage/operation-cancellation';

export class RecordingTransaction {
    private depth = 0;
    private nextBeginError?: Error;
    private nextCommitError?: Error;
    private nextRollbackError?: Error;
    private nextSavepointError?: Error;
    private nextReleaseError?: Error;
    private nextRollbackToSavepointError?: Error;

    constructor(
        private readonly operations: RecordedDatabaseOperation[],
        private readonly events: string[],
    ) {}

    public get isActive(): boolean {
        return this.depth > 0;
    }
    public failNextBegin(error: Error): void {
        this.nextBeginError = error;
    }
    public failNextCommit(error: Error): void {
        this.nextCommitError = error;
    }
    public failNextRollback(error: Error): void {
        this.nextRollbackError = error;
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

    public async run<TResult>(work: () => TResult | Promise<TResult>, options?: TransactionOptions): Promise<TResult> {
        validateRecordingTransactionOptions(this.isActive, options);
        return this.isActive
            ? this.runNested(work, options)
            : this.runOuter(work, options);
    }

    private async runNested<TResult>(work: () => TResult | Promise<TResult>, options?: TransactionOptions): Promise<TResult> {
        throwIfOperationAborted(options?.signal);
        const savepointName = `entitykit_sp_${String(this.depth)}`;
        this.depth += 1;
        this.operations.push({ kind: 'savepoint', savepointName });
        this.events.push(`savepoint:${savepointName}`);
        if (this.nextSavepointError) {
            const error = this.nextSavepointError;
            this.nextSavepointError = undefined;
            this.depth -= 1;
            throw error;
        }

        try {
            const result = await work();
            throwIfOperationAborted(options?.signal);
            if (this.nextReleaseError) {
                const error = this.nextReleaseError;
                this.nextReleaseError = undefined;
                throw error;
            }
            this.operations.push({ kind: 'release-savepoint', savepointName });
            this.events.push(`release:${savepointName}`);
            return result;
        } catch (error) {
            if (this.nextRollbackToSavepointError) {
                const rollbackError = this.nextRollbackToSavepointError;
                this.nextRollbackToSavepointError = undefined;
                throw rollbackError;
            }
            this.operations.push({ kind: 'rollback-to-savepoint', savepointName });
            this.events.push(`rollback-to:${savepointName}`);
            throw error;
        } finally {
            this.depth -= 1;
        }
    }
    private async runOuter<TResult>(work: () => TResult | Promise<TResult>, options?: TransactionOptions): Promise<TResult> {
        throwIfOperationAborted(options?.signal);
        this.depth += 1;
        this.operations.push(options
            ? { kind: 'begin', transactionOptions: { ...options } }
            : { kind: 'begin' });
        this.events.push('begin');
        if (this.nextBeginError) {
            const error = this.nextBeginError;
            this.nextBeginError = undefined;
            this.depth -= 1;
            throw error;
        }

        try {
            const result = await work();
            throwIfOperationAborted(options?.signal);
            if (this.nextCommitError) {
                const error = this.nextCommitError;
                this.nextCommitError = undefined;
                throw error;
            }
            this.operations.push({ kind: 'commit' });
            this.events.push('commit');
            return result;
        } catch (error) {
            if (this.nextRollbackError) {
                const rollbackError = this.nextRollbackError;
                this.nextRollbackError = undefined;
                throw rollbackError;
            }
            this.operations.push({ kind: 'rollback' });
            this.events.push('rollback');
            throw error;
        } finally {
            this.depth -= 1;
        }
    }
}
