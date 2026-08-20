import type { SqlStatement } from '@entitykit/core/adapter';
import type { DatabaseConnection, DatabaseOperationOptions, DatabaseQueryResult, QueryStreamOptions, TransactionOptions } from '@entitykit/core/adapter';
import { EnclosingTransactionState } from '@entitykit/core/adapter';
import { validateTransactionOptions } from '@entitykit/core/adapter';
import type { Pool, PoolClient } from './postgres-driver';
import { runPostgresTransaction } from './postgres-transaction';
import { streamPostgresConnectionRows } from './postgres-stream-lease';
import { executePostgresBufferedQuery } from './postgres-buffered-query';
import { throwIfOperationAborted } from '@entitykit/core/adapter';
import { createPostgresProviderError } from './postgres-provider-error';
import { runPostgresPooledSavepoint } from './postgres-pooled-savepoint';
import { TransactionUsability } from '@entitykit/core/adapter';
export class PostgresPooledConnection implements DatabaseConnection {
    private activeClient?: PoolClient;
    private transactionDepth = 0;
    private readonly usability = new TransactionUsability();
    private readonly transactionState = new EnclosingTransactionState();

    constructor(private readonly pool: Pool) {}

    public get isInTransaction(): boolean {
        return this.transactionDepth > 0;
    }

    public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options: DatabaseOperationOptions = {},
    ): Promise<DatabaseQueryResult<TRow>> {
        this.usability.assertUsable();
        return executePostgresBufferedQuery(
            this.pool,
            this.activeClient,
            async () => await this.connect(),
            statement,
            options,
        );
    }

    public stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options: QueryStreamOptions = {},
    ): AsyncIterable<TRow> {
        this.usability.assertUsable();
        return streamPostgresConnectionRows(
            statement,
            options,
            () => {
                this.usability.assertUsable();
                return this.activeClient;
            },
            async () => await this.connect(),
            () => this.isInTransaction,
        );
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        this.usability.assertUsable();
        validateTransactionOptions(options);
        if (this.isInTransaction) {
            if (options && (options.isolationLevel !== undefined || options.readOnly !== undefined)) {
                throw new Error('Nested Postgres transactions cannot change transaction options.');
            }
            return this.nestedTransaction(work, options);
        }
        const ownsClient = this.activeClient === undefined;
        const client = this.activeClient ?? await this.connect();
        this.activeClient = client;
        this.transactionDepth += 1;
        this.transactionState.reset();
        let clientUnsafe = false;
        try {
            return await runPostgresTransaction(
                client,
                async () => await this.transactionState.runRootWork('Postgres', work),
                options,
            );
        } catch (error) {
            clientUnsafe = this.usability.observeFailure(error);
            throw error;
        } finally {
            this.transactionDepth -= 1;
            this.transactionState.reset();
            if (ownsClient) {
                this.activeClient = undefined;
                client.release(clientUnsafe ? true : undefined);
            }
        }
    }

    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        this.usability.assertUsable();
        throwIfOperationAborted(options?.signal);
        if (this.activeClient) {
            return work();
        }
        const client = await this.connect();
        this.activeClient = client;
        let completed = false;
        try {
            throwIfOperationAborted(options?.signal);
            const result = await work();
            completed = true;
            return result;
        } finally {
            this.activeClient = undefined;
            client.release(completed ? undefined : true);
        }
    }

    private async nestedTransaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        if (!this.activeClient) {
            return work();
        }
        const depth = this.transactionDepth;
        this.transactionDepth += 1;
        try {
            return await runPostgresPooledSavepoint(
                this.activeClient,
                depth,
                this.transactionState,
                work,
                options,
            );
        } finally {
            this.transactionDepth -= 1;
        }
    }

    private async connect(): Promise<PoolClient> {
        try {
            return await this.pool.connect();
        } catch (error) {
            throw createPostgresProviderError('connect', error);
        }
    }

}
