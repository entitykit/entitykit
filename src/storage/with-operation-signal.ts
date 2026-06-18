import type { SqlStatement } from '../sql/sql-statement';
import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionOptions,
} from './database-connection';

/** Apply one cancellation signal to every operation issued through a connection. */
export function withOperationSignal(
    database: DatabaseConnection,
    signal: AbortSignal | undefined,
): DatabaseConnection {
    if (!signal) {
        return database;
    }
    const stream = database.stream?.bind(database);
    const session = database.session?.bind(database);
    return {
        get isInTransaction(): boolean {
            return database.isInTransaction;
        },
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
            statement: SqlStatement,
            options?: DatabaseOperationOptions,
        ): Promise<DatabaseQueryResult<TRow>> {
            return await database.query<TRow>(statement, withSignal(options, signal));
        },
        async transaction<TResult>(
            work: () => TResult | Promise<TResult>,
            options?: TransactionOptions,
        ): Promise<TResult> {
            return await database.transaction(work, withSignal(options, signal));
        },
        ...stream ? {
            stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
                statement: SqlStatement,
                options?: QueryStreamOptions,
            ): AsyncIterable<TRow> {
                return stream<TRow>(statement, withSignal(options, signal));
            },
        } : {},
        ...session ? {
            async session<TResult>(
                work: () => TResult | Promise<TResult>,
                options?: DatabaseOperationOptions,
            ): Promise<TResult> {
                return await session(work, withSignal(options, signal));
            },
        } : {},
        ...database.dispose ? { dispose: database.dispose.bind(database) } : {},
    };
}

function withSignal<TOptions extends DatabaseOperationOptions>(
    options: TOptions | undefined,
    signal: AbortSignal,
): TOptions & { readonly signal: AbortSignal } {
    const operationSignal = options?.signal && options.signal !== signal
        ? AbortSignal.any([signal, options.signal])
        : signal;
    return Object.assign({}, options, { signal: operationSignal });
}
