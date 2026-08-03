import type { SqlStatement } from '../../sql/sql-statement';
import type { DatabaseConnection, DatabaseOperationOptions, DatabaseQueryResult, QueryStreamOptions, TransactionOptions } from '../../storage/database-connection';
import { DatabaseProviderError, DatabaseTransactionCleanupError } from '../../storage/database-errors';
import { EnclosingTransactionState } from '../../storage/enclosing-transaction-state';
import { validateTransactionOptions } from '../../storage/transaction-options';
import type { MySqlConnection, MySqlPool } from './mysql-driver';
import { createMysqlProviderError } from './mysql-provider-error';
import { runMysqlSavepoint, runMysqlTransaction } from './mysql-transaction';
import { streamMysqlConnectionRows } from './mysql-stream-lease';
import { executeMysqlBufferedQuery } from './mysql-buffered-query';
import { throwIfOperationAborted } from '../../storage/operation-cancellation';
import { findTransactionOutcomeUnknown } from '../../storage/transaction-outcome';
import type { TransactionOutcomeUnknownError } from '../../storage/transaction-outcome-unknown-error';

export class MySqlPooledConnection implements DatabaseConnection {
    private activeConnection?: MySqlConnection;
    private transactionDepth = 0;
    private outcomeUnknown?: TransactionOutcomeUnknownError;
    private readonly transactionState = new EnclosingTransactionState();

    constructor(
        private readonly pool: MySqlPool,
        private readonly commandTimeoutMs?: number,
    ) {}

    public get isInTransaction(): boolean {
        return this.transactionDepth > 0;
    }

    public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options: DatabaseOperationOptions = {},
    ): Promise<DatabaseQueryResult<TRow>> {
        this.assertUsable();
        return executeMysqlBufferedQuery(
            this.pool,
            this.activeConnection,
            async () => await this.connect(),
            statement,
            this.commandTimeoutMs,
            options,
        );
    }

    public stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options: QueryStreamOptions = {},
    ): AsyncIterable<TRow> {
        this.assertUsable();
        return streamMysqlConnectionRows(
            statement,
            options,
            () => this.activeConnection,
            async () => await this.connect(),
            this.commandTimeoutMs,
        );
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        this.assertUsable();
        validateTransactionOptions(options);
        if (this.isInTransaction) {
            if (options && (options.isolationLevel !== undefined || options.readOnly !== undefined)) {
                throw new Error('Nested MySQL transactions cannot change transaction options.');
            }
            return this.nestedTransaction(work, options);
        }
        const ownsConnection = this.activeConnection === undefined;
        const connection = this.activeConnection ?? await this.connect();
        this.activeConnection = connection;
        this.transactionDepth = 1;
        this.transactionState.reset();
        let connectionUnsafe = false;
        try {
            return await runMysqlTransaction(
                connection,
                async () => await this.transactionState.runRootWork('MySQL', work),
                options,
                this.commandTimeoutMs,
            );
        } catch (error) {
            this.outcomeUnknown = findTransactionOutcomeUnknown(error);
            connectionUnsafe =
                this.outcomeUnknown !== undefined ||
                error instanceof DatabaseTransactionCleanupError
                && error.operation === 'rollback'
                || error instanceof DatabaseProviderError
                && error.operation === 'begin';
            throw error;
        } finally {
            this.transactionDepth = 0;
            this.transactionState.reset();
            if (ownsConnection) {
                this.activeConnection = undefined;
                if (connectionUnsafe) connection.destroy();
                else connection.release();
            }
        }
    }

    public async session<TResult>(work: () => TResult | Promise<TResult>, options?: DatabaseOperationOptions): Promise<TResult> {
        this.assertUsable();
        throwIfOperationAborted(options?.signal);
        if (this.activeConnection) {
            return work();
        }
        const connection = await this.connect();
        this.activeConnection = connection;
        let completed = false;
        try {
            throwIfOperationAborted(options?.signal);
            const result = await work();
            completed = true;
            return result;
        } finally {
            this.activeConnection = undefined;
            if (completed) connection.release();
            else connection.destroy();
        }
    }

    private async nestedTransaction<TResult>(work: () => TResult | Promise<TResult>, options?: TransactionOptions): Promise<TResult> {
        const connection = this.activeConnection;
        if (!connection) {
            return work();
        }
        const depth = this.transactionDepth++;
        try {
            try {
                return await runMysqlSavepoint(
                    connection,
                    depth,
                    work,
                    options,
                    this.commandTimeoutMs,
                    error => {
                        this.transactionState.markRecovered(error);
                    },
                );
            } catch (error) {
                this.transactionState.observeNestedFailure(error);
                throw error;
            }
        } finally {
            this.transactionDepth -= 1;
        }
    }
    private async connect(): Promise<MySqlConnection> {
        try {
            return await this.pool.getConnection();
        } catch (error) {
            throw createMysqlProviderError('connect', error);
        }
    }
    private assertUsable(): void {
        if (this.outcomeUnknown) {
            throw this.outcomeUnknown;
        }
    }
}
