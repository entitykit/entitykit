import type { SqlStatement } from '../sql/sql-statement';
import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionOptions,
} from './database-connection';
import {
    ProviderCapabilityError,
} from '../errors/runtime-errors';
import { queryStreamBatchSize } from './query-stream-options';
import { ExclusiveOperationGuard } from './exclusive-operation-guard';
import { throwIfOperationAborted } from './operation-cancellation';
import {
    findTransactionOutcomeUnknown,
} from './transaction-outcome';
import type { TransactionOutcomeUnknownError } from './transaction-outcome-unknown-error';

/**
 * Rejects overlapping use of one context connection while preserving nested
 * work in the same async transaction chain.
 */
export class GuardedDatabaseConnection implements DatabaseConnection {
    private readonly operations = new ExclusiveOperationGuard();
    private outcomeUnknown?: TransactionOutcomeUnknownError;

    constructor(private readonly inner: DatabaseConnection) {}

    public get isInTransaction(): boolean {
        return this.inner.isInTransaction;
    }

    public get isOperationInProgress(): boolean {
        return this.operations.isOperationInProgress;
    }

    public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.assertUsable();
        return this.operations.runQuery(
            'a query',
            async () => {
                throwIfOperationAborted(options?.signal);
                const result = await this.inner.query<TRow>(statement, options);
                throwIfOperationAborted(options?.signal);
                return result;
            },
        );
    }

    public stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncIterable<TRow> {
        this.assertUsable();
        if (!this.inner.stream) {
            throw new ProviderCapabilityError('streaming queries');
        }
        queryStreamBatchSize(options);
        return this.operations.stream(
            () => this.createInnerStream<TRow>(statement, options),
        );
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        this.assertUsable();
        try {
            return await this.operations.run(
                'a transaction',
                async () => this.inner.transaction(async () => {
                    throwIfOperationAborted(options?.signal);
                    const result = await work();
                    throwIfOperationAborted(options?.signal);
                    return result;
                }, options),
            );
        } catch (error) {
            this.outcomeUnknown = findTransactionOutcomeUnknown(error);
            throw error;
        }
    }

    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        this.assertUsable();
        return this.operations.run(
            'a provider session',
            async () => {
                throwIfOperationAborted(options?.signal);
                return this.inner.session?.(work, options) ?? work();
            },
        );
    }

    public async dispose(): Promise<void> {
        return this.operations.run(
            'disposal',
            async () => this.inner.dispose?.() ?? Promise.resolve(),
        );
    }

    private createInnerStream<TRow extends Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncIterable<TRow> {
        if (!this.inner.stream) {
            throw new ProviderCapabilityError('streaming queries');
        }
        return this.inner.stream<TRow>(statement, options);
    }

    public assertUsable(): void {
        if (this.outcomeUnknown) {
            throw this.outcomeUnknown;
        }
    }
}
