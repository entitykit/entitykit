import { MigrationLockReleaseError } from '../../errors/migration-errors';
import type { DatabaseConnection, DatabaseOperationOptions } from '../../storage/database-connection';
import {
    acquireMigrationLockStatement,
    releaseMigrationLockStatement,
} from '../migration-history';
import type { MigrationSqlDialect } from '../migration-sql-dialect';
import type { MigrationDiagnostics } from './migration-diagnostics';

/** Owns one migration update's provider lock and its mandatory cleanup. */
export class MigrationUpdateLock {
    private acquired = false;
    private readonly acquireStatement;
    private readonly releaseStatement;

    constructor(
        private readonly database: DatabaseConnection,
        private readonly dialect: MigrationSqlDialect,
        private readonly diagnostics: MigrationDiagnostics,
    ) {
        this.acquireStatement = acquireMigrationLockStatement(dialect);
        this.releaseStatement = releaseMigrationLockStatement(dialect);
    }

    public get supported(): boolean {
        return this.acquireStatement !== undefined;
    }

    public async acquire(options?: DatabaseOperationOptions): Promise<void> {
        const acquireStatement = this.acquireStatement;
        if (!acquireStatement) {
            return;
        }

        await this.diagnostics.runLock('lockAcquire', async () => {
            const result = await this.database.query(acquireStatement, options);
            this.dialect.validateMigrationLockAcquired?.(result);
            // Set inside the diagnostic wrapper: a user handler can throw after the
            // database acquired the lock, and cleanup must still run.
            this.acquired = true;
        });
    }

    public async release(primaryError?: unknown): Promise<void> {
        const releaseStatement = this.releaseStatement;
        if (!this.acquired || !releaseStatement) {
            return;
        }

        try {
            await this.diagnostics.runLock('lockRelease', async () => {
                const result = await this.database.query(releaseStatement);
                this.dialect.validateMigrationLockReleased?.(result);
                this.acquired = false;
            });
        } catch (releaseError) {
            if (primaryError) {
                throw new MigrationLockReleaseError(releaseError, primaryError);
            }
            throw releaseError;
        }
    }
}
