import type { DatabaseConnection, DatabaseOperationOptions } from '../../storage/database-connection';
import type { SqlStatement } from '../../sql/sql-statement';
import { MigrationExecutionError } from '../../errors/migration-errors';
import type { Migration } from '../migration';
import type { MigrationDiagnostics } from './migration-diagnostics';
import { OperationCanceledError } from '../../errors/runtime-errors';
import { startElapsedTimer } from '../../diagnostics/runtime/elapsed-time';

export class MigrationExecutor {
    constructor(
        private readonly database: DatabaseConnection,
        private readonly diagnostics: MigrationDiagnostics,
    ) {}

    public async runMigration(
        migration: Migration,
        direction: 'up' | 'down',
        statements: readonly SqlStatement[],
        options: DatabaseOperationOptions = {},
    ): Promise<void> {
        const elapsed = startElapsedTimer();
        const statementCount = statements.length;
        const transactionSuppressedStatements = statements.filter(statement => statement.suppressTransaction).length;
        try {
            await this.run(statements, options);
            this.diagnostics.emit({
                phase: direction === 'up' ? 'apply' : 'rollback',
                migrationId: migration.id,
                migrationName: migration.name,
                direction,
                statementCount,
                transactionSuppressedStatements,
                durationMs: elapsed(),
            });
        } catch (error) {
            if (error instanceof OperationCanceledError) {
                this.diagnostics.emit({
                    phase: direction === 'up' ? 'apply' : 'rollback',
                    migrationId: migration.id,
                    migrationName: migration.name,
                    direction,
                    statementCount,
                    transactionSuppressedStatements,
                    durationMs: elapsed(),
                    error,
                });
                throw error;
            }
            const executionError = new MigrationExecutionError({
                migrationId: migration.id,
                migrationName: migration.name,
                phase: direction === 'up' ? 'apply' : 'rollback',
                direction,
                statementCount,
                transactionSuppressedStatements,
                cause: error,
            });
            this.diagnostics.emit({
                phase: direction === 'up' ? 'apply' : 'rollback',
                migrationId: migration.id,
                migrationName: migration.name,
                direction,
                statementCount,
                transactionSuppressedStatements,
                durationMs: elapsed(),
                error: executionError,
            });
            throw executionError;
        }
    }

    private async run(
        statements: readonly SqlStatement[],
        options: DatabaseOperationOptions,
    ): Promise<void> {
        let batch: SqlStatement[] = [];
        const flushBatch = async (): Promise<void> => {
            if (batch.length === 0) {
                return;
            }

            const currentBatch = batch;
            batch = [];
            await this.database.transaction(async () => {
                for (const statement of currentBatch) {
                    await this.database.query(statement, options);
                }
            }, options);
        };

        for (const statement of statements) {
            if (statement.suppressTransaction) {
                await flushBatch();
                await this.database.query(statement, options);
                continue;
            }

            batch.push(statement);
        }

        await flushBatch();
    }
}
