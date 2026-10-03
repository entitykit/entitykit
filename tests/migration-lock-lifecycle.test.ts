import { postgresMigrationDialect } from '../packages/core/src/migrations/migration-sql-dialect';
import { MigrationDiagnostics } from '../packages/core/src/migrations/runner/migration-diagnostics';
import { MigrationUpdateLock } from '../packages/core/src/migrations/runner/migration-update-lock';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('migration lock cleanup ownership', () => {
    it('releases exactly once when the adapter omits optional release validation', async () => {
        const connection = new RecordingDatabaseConnection();
        const dialect = { ...postgresMigrationDialect };
        delete dialect.validateMigrationLockReleased;
        const lock = new MigrationUpdateLock(connection, dialect, new MigrationDiagnostics(dialect, {}));

        await lock.acquire();
        await lock.release();
        await lock.release();

        expect(connection.statements.map(statement => statement.text)).toEqual([
            'select pg_advisory_lock(hashtext($1))',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
    });
});
