import type { DatabaseConnection } from '../../storage/database-connection';
import {
    MigrationChecksumError,
    MigrationDataLossError,
} from '../../errors/migration-errors';
import type { Migration } from '../migration';
import { createMigrationHistoryTableStatement } from '../migration-history';
import type { MigrationSqlGenerator } from '../migration-sql-generator';
import type { MigrationSqlDialect } from '../migration-sql-dialect';
import {
    migrationIdFromError,
} from './history-validation';
import { createMigrationUpdatePlan } from './migration-update-plan';
import type { MigrationDiagnostics } from './migration-diagnostics';
import type { MigrationExecutor } from './migration-executor';
import type { MigrationUpdateOptions, MigrationUpdateResult } from './migration-runner-options';
import { MigrationUpdateLock } from './migration-update-lock';
import { readMigrationHistory } from './read-migration-history';
import { startElapsedTimer } from '../../diagnostics/runtime/elapsed-time';

export class MigrationUpdateRunner {
    constructor(
        private readonly database: DatabaseConnection,
        private readonly dialect: MigrationSqlDialect,
        private readonly generator: MigrationSqlGenerator,
        private readonly executor: MigrationExecutor,
        private readonly diagnostics: MigrationDiagnostics,
        private readonly checksum: (migration: Migration) => string,
    ) {}

    public async update(
        migrations: readonly Migration[],
        options: MigrationUpdateOptions,
    ): Promise<MigrationUpdateResult> {
        const runInSession = this.database.session?.bind(this.database)
      ?? (async <TResult>(work: () => TResult | Promise<TResult>) => work());
        return runInSession(
            async () => this.updateInSession(migrations, options),
            options,
        );
    }

    private async updateInSession(
        migrations: readonly Migration[],
        options: MigrationUpdateOptions,
    ): Promise<MigrationUpdateResult> {
        const discoveryElapsed = startElapsedTimer();
        const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
        this.diagnostics.emit({
            phase: 'discovery',
            durationMs: discoveryElapsed(),
            migrationCount: ordered.length,
        });

        const createHistory = createMigrationHistoryTableStatement(this.dialect);
        await this.database.query(createHistory, options);
        const lock = new MigrationUpdateLock(
            this.database,
            this.dialect,
            this.diagnostics,
        );
        let updateError: unknown;
        try {
            await lock.acquire(options);
            const applied = await readMigrationHistory(
                this.database,
                this.dialect,
                options,
            );
            let plan;
            try {
                plan = createMigrationUpdatePlan(
                    ordered,
                    applied,
                    this.checksum,
                    options.target,
                );
            } catch (error) {
                this.diagnostics.emit({
                    phase: error instanceof MigrationChecksumError ? 'checksumFailure' : 'historyValidationFailure',
                    durationMs: 0,
                    migrationId: migrationIdFromError(error),
                    error,
                });
                throw error;
            }
            this.diagnostics.emit({
                phase: 'pending',
                durationMs: 0,
                migrationCount: plan.steps.length,
                pendingMigrations: plan.steps.map(item => `${item.direction}:${item.migration.id}`),
                target: plan.target,
            });

            if (plan.warnings.length > 0 && !options.allowDataLoss) {
                throw new MigrationDataLossError(plan.warnings);
            }

            const appliedMigrations: string[] = [];
            let transactionSuppressedStatements = 0;
            for (const item of plan.steps) {
                const statements = item.direction === 'up'
                    ? this.generator.buildUpStatements(item.migration).filter(statement => statement.text !== createHistory.text)
                    : this.generator.buildDownStatements(item.migration);
                transactionSuppressedStatements += statements.filter(statement => statement.suppressTransaction).length;
                await this.executor.runMigration(
                    item.migration,
                    item.direction,
                    statements,
                    options,
                );
                appliedMigrations.push(`${item.direction}:${item.migration.id}`);
            }

            return {
                appliedMigrations,
                usedMigrationLock: lock.supported,
                transactionSuppressedStatements,
            };
        } catch (error) {
            updateError = error;
            throw error;
        } finally {
            await lock.release(updateError);
        }
    }
}
