import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import type { DatabaseSync } from 'node:sqlite';
import type { SqlStatement } from '../../sql/sql-statement';
import type { DatabaseProviderOperation } from '../../storage/database-provider-error';
import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionOptions,
} from '../../storage/database-connection';
import type { SqliteConnectionConfig } from '../../storage/built-in-provider-config';
import { sqliteError } from './sqlite-error';
import { iterateStatement } from './sqlite-statement';
import {
    resolveSqliteConnectionConfig,
} from './sqlite-connection-config';
import { SqliteTransactionRunner } from './sqlite-transaction-runner';
import {
    queryStreamBatchSize,
    throwIfQueryAborted,
} from '../../storage/query-stream-options';
import { OperationCanceledError } from '../../errors/runtime-errors';
import { throwIfOperationAborted } from '../../storage/operation-cancellation';
import { executeSqliteBufferedQuery } from './sqlite-buffered-query';

const loadModule = createRequire(__filename);

export type { SqliteConnectionConfig } from '../../storage/built-in-provider-config';
export { defaultSqliteBusyTimeoutMs } from './sqlite-connection-config';

/**
 * `DatabaseConnection` over Node's built-in `node:sqlite` (`DatabaseSync`).
 *
 * SQLite uses a single synchronous connection, so there is no pool. This class
 * is the composition root: statement execution (`SqliteStatement`),
 * transaction/savepoint handling (`SqliteTransactionRunner`), value binding
 * (`SqliteBinding`) and error mapping (`SqliteError`) each live in a focused
 * module, and the connection wires them onto the one open handle.
 */
export class SqliteDatabaseConnection implements DatabaseConnection {
    private readonly db: DatabaseSync;
    private readonly transactions: SqliteTransactionRunner;

    constructor(config: string | SqliteConnectionConfig) {
        const { filename, options, busyTimeoutMs } =
            resolveSqliteConnectionConfig(config);

        try {
            // Load node:sqlite lazily, so importing `entitykit` (or using another
            // provider) never pulls in the driver — it loads only when a SQLite
            // connection is actually opened, matching how pg/mysql2 stay lazy.

            const { DatabaseSync } = loadModule('node:sqlite') as typeof NodeSqlite;
            this.db = new DatabaseSync(filename, {
                readOnly: options.readOnly,
                enableForeignKeyConstraints: options.foreignKeys,
            });
            // SQLite's LIKE is case-insensitive for ASCII by default, unlike
            // Postgres. Matching Postgres keeps a `like(...)` filter returning the
            // same rows on both providers.
            this.db.exec('pragma case_sensitive_like = ON');

            this.db.exec(`pragma busy_timeout = ${String(busyTimeoutMs)}`);

            if (options.journalMode !== undefined) {
                this.db.exec(`pragma journal_mode = ${options.journalMode}`);
            }
        } catch (error) {
            throw sqliteError('connect', error);
        }

        this.transactions = new SqliteTransactionRunner((sql, operation) => {
            this.exec(sql, operation);
        });
    }

    /** Whether in transaction. */ public get isInTransaction(): boolean {
        return this.transactions.isInTransaction;
    }

    /** Perform the query operation. */ public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options: DatabaseOperationOptions = {},
    ): Promise<DatabaseQueryResult<TRow>> {
        return executeSqliteBufferedQuery(this.db, statement, options);
    }

    /** Stream SQLite rows lazily from `StatementSync.iterate()`. */
    public async *stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options: QueryStreamOptions = {},
    ): AsyncGenerator<TRow> {
        await Promise.resolve();
        queryStreamBatchSize(options);
        throwIfQueryAborted(options.signal);
        try {
            for (const row of iterateStatement<TRow>(this.db, statement)) {
                throwIfQueryAborted(options.signal);
                yield row;
            }
            throwIfQueryAborted(options.signal);
        } catch (error) {
            if (error instanceof OperationCanceledError) {
                throw error;
            }
            throw sqliteError('stream', error, statement);
        }
    }

    /** Perform the transaction operation. */ public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        return this.transactions.transaction(work, options);
    }

    /** Run work on SQLite's single connection. */
    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        // node:sqlite is a single synchronous connection; there is no pooled session.
        throwIfOperationAborted(options?.signal);
        return work();
    }

    /** Release resources owned by this object. */ public async dispose(): Promise<void> {
        try {
            this.db.close();
            await Promise.resolve();
        } catch (error) {
            throw sqliteError('dispose', error);
        }
    }

    private exec(sql: string, operation: DatabaseProviderOperation): void {
        try {
            this.db.exec(sql);
        } catch (error) {
            throw sqliteError(operation, error);
        }
    }
}
