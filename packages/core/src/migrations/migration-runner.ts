import type { DatabaseConnection } from '../storage/database-connection';
import { MigrationError } from '../errors/migration-errors';
import type { Migration } from './migration';
import type { MigrationBuilderFactory } from './migration-builder-contract';
import { resolveMigrationBuilderFactory } from './migration-builder-factory';
import { migrationChecksum, type MigrationHistoryRow } from './migration-history';
import { MigrationSqlGenerator } from './migration-sql-generator';
import { postgresMigrationDialect, type MigrationSqlDialect } from './migration-sql-dialect';
import { MigrationDiagnostics } from './runner/migration-diagnostics';
import { MigrationExecutor } from './runner/migration-executor';
import { runMigrationLockOperation } from './runner/migration-lock-operation';
import type {
    MigrationRunnerDiagnosticsOptions,
    MigrationHistoryOptions,
    MigrationOperationOptions,
    MigrationUpdateOptions,
    MigrationUpdateResult,
} from './runner/migration-runner-options';
import { MigrationUpdateRunner } from './runner/migration-update-runner';
import { readMigrationHistory } from './runner/read-migration-history';

export type {
    MigrationDiagnosticsHandler,
    MigrationRunnerDiagnosticsOptions,
    MigrationHistoryOptions,
    MigrationOperationOptions,
    MigrationUpdateOptions,
    MigrationUpdateResult,
} from './runner/migration-runner-options';
/** EntityKit implementation of migration runner. */ export class MigrationRunner {
    private readonly generator: MigrationSqlGenerator;
    private readonly executor: MigrationExecutor;
    private readonly updater: MigrationUpdateRunner;
    private readonly diagnostics: MigrationDiagnostics;

    constructor(
        private readonly database: DatabaseConnection,
        private readonly dialect: MigrationSqlDialect = postgresMigrationDialect,
        createMigrationBuilder?: MigrationBuilderFactory,
        diagnosticsOptions: MigrationRunnerDiagnosticsOptions = {},
    ) {
        const builderFactory = resolveMigrationBuilderFactory(
            dialect,
            createMigrationBuilder,
        );
        this.generator = new MigrationSqlGenerator(dialect, builderFactory);
        this.diagnostics = new MigrationDiagnostics(dialect, diagnosticsOptions);
        this.executor = new MigrationExecutor(database, this.diagnostics, dialect);
        this.updater = new MigrationUpdateRunner(
            database,
            dialect,
            this.generator,
            this.executor,
            this.diagnostics,
            migration => migrationChecksum(
                migration,
                dialect.sql,
                builderFactory,
            ),
        );
    }

    /** Perform the apply operation. */ public async apply(
        migration: Migration,
        options: MigrationOperationOptions = {},
    ): Promise<void> {
        this.assertOutsideTransaction('apply');
        await this.runWithMigrationLock(
            async () => this.executor.runMigration(
                migration,
                'up',
                this.generator.buildUpStatements(migration),
                options,
            ),
            options,
        );
    }

    /** Perform the revert operation. */ public async revert(
        migration: Migration,
        options: MigrationOperationOptions = {},
    ): Promise<void> {
        this.assertOutsideTransaction('revert');
        await this.runWithMigrationLock(
            async () => this.executor.runMigration(
                migration,
                'down',
                this.generator.buildDownStatements(migration),
                options,
            ),
            options,
        );
    }

    /** Return applied migrations. */ public async getAppliedMigrations(
        options: MigrationHistoryOptions = {},
    ): Promise<MigrationHistoryRow[]> {
        if (options.initializeHistory === false) {
            return readMigrationHistory(this.database, this.dialect, options, 'check');
        }
        this.assertOutsideTransaction('history initialization');
        return this.runWithMigrationLock(
            async () => readMigrationHistory(this.database, this.dialect, options),
            options,
        );
    }

    /** Perform the update operation. */ public async update(
        migrations: readonly Migration[],
        options: MigrationUpdateOptions = {},
    ): Promise<MigrationUpdateResult> {
        this.assertOutsideTransaction('update');
        return this.updater.update(migrations, options);
    }

    private assertOutsideTransaction(operation: string): void {
        if (!this.database.isInTransaction) {
            return;
        }
        throw new MigrationError(
            `Migration ${operation} cannot run inside an active transaction. ` +
      'Let the current transaction finish first; EntityKit owns migration ' +
      'transactions so locks and transaction-suppressed statements remain correct.',
        );
    }

    private async runWithMigrationLock<TResult>(
        work: () => TResult | Promise<TResult>,
        options: MigrationOperationOptions,
    ): Promise<TResult> {
        return runMigrationLockOperation(
            this.database, this.dialect, this.diagnostics, work, options,
        );
    }
}
