import type { DatabaseConnection } from '../../storage/database-connection';
import type { MigrationSqlDialect } from '../migration-sql-dialect';
import type { MigrationDiagnostics } from './migration-diagnostics';
import type { MigrationOperationOptions } from './migration-runner-options';
import { MigrationUpdateLock } from './migration-update-lock';

/** Keep provider lock acquisition, work and release on one owned session. */
export async function runMigrationLockOperation<TResult>(
    database: DatabaseConnection,
    dialect: MigrationSqlDialect,
    diagnostics: MigrationDiagnostics,
    work: () => TResult | Promise<TResult>,
    options: MigrationOperationOptions,
): Promise<TResult> {
    const runInSession = database.session?.bind(database)
        ?? (async <T>(sessionWork: () => Promise<T>) => sessionWork());
    return runInSession(async () => {
        const lock = new MigrationUpdateLock(database, dialect, diagnostics);
        let primaryError: unknown;
        try {
            await lock.acquire(options);
            return await work();
        } catch (error) {
            primaryError = error;
            throw error;
        } finally {
            await lock.release(primaryError);
        }
    }, options);
}
