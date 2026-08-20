import { MigrationRunner } from '../packages/core/src/migrations/migration-runner';
import { postgresMigrationDialect } from '../packages/core/src/migrations/migration-sql-dialect';
import { mySqlMigrationDialect } from '../packages/mysql/src/mysql-migration-dialect';
import { sqliteMigrationDialect } from '../packages/sqlite/src/sqlite-dialect';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('read-only migration history', () => {
    it('returns empty history without creating the history table', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ exists: false }] });

        const history = await new MigrationRunner(connection)
            .getAppliedMigrations({ initializeHistory: false });

        expect(history).toEqual([]);
        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]?.text).toContain('select exists');
        expect(connection.statements[0]?.text).not.toContain('create table');
    });

    it('reads existing history after a non-mutating existence check', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ exists: true }] });
        connection.queueResult({
            rows: [{
                id: '20260801000000_InitialCreate',
                name: 'InitialCreate',
                checksum: 'checksum',
            }],
        });

        const history = await new MigrationRunner(connection)
            .getAppliedMigrations({ initializeHistory: false });

        expect(history).toEqual([expect.objectContaining({
            id: '20260801000000_InitialCreate',
        })]);
        expect(connection.statements).toHaveLength(2);
        expect(connection.statements.every(statement =>
            !statement.text.startsWith('create table'))).toBe(true);
    });

    it.each([
        ['postgres', postgresMigrationDialect],
        ['sqlite', sqliteMigrationDialect],
        ['mysql', mySqlMigrationDialect],
    ] as const)('%s parameterizes the history-table name', (_name, dialect) => {
        const statement = dialect.migrationHistoryTableExistsStatement?.();

        expect(statement?.text).toContain('select exists');
        expect(statement?.text).not.toContain('__entitykit_migrations');
        expect(statement?.values).toEqual(['__entitykit_migrations']);
    });
});
