import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionOptions,
} from '../../storage/database-connection';
import type { SqlStatement } from '../../sql/sql-statement';
import type { RuntimeDiagnosticsEmitter } from './events';
import { startElapsedTimer } from './elapsed-time';
import { transactionFailurePhase } from './transaction-failure-phase';
import { ProviderCapabilityError } from '../../errors/runtime-errors';

export class DiagnosticDatabaseConnection implements DatabaseConnection {
    constructor(
        private readonly inner: DatabaseConnection,
        private readonly provider: string,
        private readonly handler: RuntimeDiagnosticsEmitter,
    ) {}

    public get isInTransaction(): boolean {
        return this.inner.isInTransaction;
    }

    public async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        const elapsed = startElapsedTimer();
        try {
            const result = await this.inner.query<TRow>(statement, options);
            this.handler({
                kind: 'query',
                provider: this.provider,
                statement: cloneStatement(statement),
                durationMs: elapsed(),
                rowCount: result.rowCount,
            });
            return result;
        } catch (error) {
            this.handler({
                kind: 'query',
                provider: this.provider,
                statement: cloneStatement(statement),
                durationMs: elapsed(),
                error,
            });
            throw error;
        }
    }

    public stream<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncIterable<TRow> {
        if (!this.inner.stream) {
            throw new ProviderCapabilityError('streaming queries', this.provider);
        }
        const rows = this.inner.stream<TRow>(statement, options);
        const provider = this.provider;
        const handler = this.handler;
        return {
            async *[Symbol.asyncIterator]() {
                const elapsed = startElapsedTimer();
                let rowCount = 0;
                let failed = false;
                try {
                    for await (const row of rows) {
                        rowCount++;
                        yield row;
                    }
                } catch (error) {
                    failed = true;
                    handler({
                        kind: 'query',
                        provider,
                        statement: cloneStatement(statement),
                        durationMs: elapsed(),
                        error,
                    });
                    throw error;
                } finally {
                    if (!failed) {
                        handler({
                            kind: 'query',
                            provider,
                            statement: cloneStatement(statement),
                            durationMs: elapsed(),
                            rowCount,
                        });
                    }
                }
            },
        };
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        const elapsed = startElapsedTimer();
        const nested = this.isInTransaction;
        this.handler({
            kind: 'transaction',
            provider: this.provider,
            phase: nested ? 'savepoint' : 'begin',
        });
        try {
            const result = await this.inner.transaction(work, options);
            this.handler({
                kind: 'transaction',
                provider: this.provider,
                phase: nested ? 'release' : 'commit',
                durationMs: elapsed(),
            });
            return result;
        } catch (error) {
            this.handler({
                kind: 'transaction',
                provider: this.provider,
                phase: transactionFailurePhase(error, nested),
                durationMs: elapsed(),
                error,
            });
            throw error;
        }
    }

    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        return this.inner.session ? this.inner.session(work, options) : work();
    }

    public async dispose(): Promise<void> {
        await this.inner.dispose?.();
    }
}

function cloneStatement(statement: SqlStatement): SqlStatement {
    return {
        text: statement.text,
        values: [...statement.values],
    };
}
