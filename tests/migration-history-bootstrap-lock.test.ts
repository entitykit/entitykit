import type {
    DatabaseConnection, DatabaseOperationOptions, DatabaseQueryResult, SqlStatement,
} from '@entitykit/core';
import { MigrationRunner } from '@entitykit/core/migrations';
import type { MigrationSqlDialect } from '@entitykit/core/migrations';
import { mySqlMigrationDialect } from '../packages/mysql/src/mysql-migration-dialect';
import { postgresMigrationDialect } from '../packages/core/src/migrations/migration-sql-dialect';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class BootstrapConnection extends RecordingDatabaseConnection {
    private locked = false;
    public bootstrapFailure?: Error;
    public releaseFailure?: Error;

    constructor(private readonly dialect: MigrationSqlDialect) {
        super();
    }

    public override async query<TRow extends Record<string, unknown>>(
        statement: SqlStatement, options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        const acquire = this.dialect.acquireMigrationLockStatement?.().text;
        const release = this.dialect.releaseMigrationLockStatement?.().text;
        if (statement.text === acquire) {
            this.locked = true;
            this.queueResult({ rows: [{ acquired: 1 }] });
        } else if (statement.text === release) {
            this.locked = false;
            if (this.releaseFailure) this.queueError(this.releaseFailure);
            else this.queueResult({ rows: [{ released: 1, pg_advisory_unlock: true }] });
        } else if (statement.text.startsWith('create table')) {
            expect(this.locked).toBe(true);
            expect(this.sessionEvents.at(-1)).toBe('start');
            if (this.bootstrapFailure) this.queueError(this.bootstrapFailure);
            else this.queueResult();
        } else this.queueResult();
        return super.query<TRow>(statement, options);
    }
}

describe.each([
    ['postgres', postgresMigrationDialect], ['mysql', mySqlMigrationDialect],
] as const)('%s migration history bootstrap ownership', (_name, dialect) => {
    it.each(['update', 'history'] as const)('initializes %s history once inside the provider lock', async operation => {
        const connection = new BootstrapConnection(dialect);
        const runner = new MigrationRunner(connection, dialect);
        if (operation === 'update') await runner.update([]);
        else await runner.getAppliedMigrations();
        expect(connection.statements[0]?.text).toBe(dialect.acquireMigrationLockStatement?.().text);
        expect(connection.statements.at(-1)?.text).toBe(dialect.releaseMigrationLockStatement?.().text);
        expect(connection.statements.filter(statement => statement.text.startsWith('create table'))).toHaveLength(1);
        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });

    it.each(['update', 'history'] as const)('releases the lock when %s bootstrap fails', async operation => {
        const connection = new BootstrapConnection(dialect);
        const failure = new Error('history bootstrap failed');
        connection.bootstrapFailure = failure;
        const runner = new MigrationRunner(connection, dialect);
        const work = operation === 'update' ? runner.update([]) : runner.getAppliedMigrations();
        await expect(work).rejects.toBe(failure);
        expect(connection.statements.at(-1)?.text).toBe(dialect.releaseMigrationLockStatement?.().text);
        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });

    it('retains the initialization failure when lock cleanup also fails', async () => {
        const connection = new BootstrapConnection(dialect);
        const failure = new Error('history bootstrap failed');
        const releaseFailure = new Error('lock release failed');
        connection.bootstrapFailure = failure;
        connection.releaseFailure = releaseFailure;
        await expect(new MigrationRunner(connection, dialect).getAppliedMigrations()).rejects.toMatchObject({
            name: 'MigrationLockReleaseError', primaryError: failure, releaseError: releaseFailure,
        });
        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });

    it('returns the cleanup failure after otherwise successful initialization', async () => {
        const connection = new BootstrapConnection(dialect);
        const failure = new Error('lock release failed');
        connection.releaseFailure = failure;
        await expect(new MigrationRunner(connection, dialect).getAppliedMigrations()).rejects.toBe(failure);
        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });

    it.each(['update', 'history'] as const)('forwards cancellation to %s and keeps cleanup uncancelable', async operation => {
        const connection = new BootstrapConnection(dialect);
        const options = { signal: new AbortController().signal };
        const query = jest.spyOn(connection, 'query');
        const session = jest.spyOn(connection, 'session');
        const runner = new MigrationRunner(connection, dialect);
        if (operation === 'update') await runner.update([], options);
        else await runner.getAppliedMigrations(options);
        expect(session.mock.calls[0]?.[1]).toBe(options);
        expect(query.mock.calls.slice(0, -1).map(call => call[1])).toEqual([options, options, options]);
        expect(query.mock.calls.at(-1)?.[1]).toBeUndefined();
    });

    it.each(['update', 'history'] as const)('initializes %s on an adapter without the optional session capability', async operation => {
        const recorded = new RecordingDatabaseConnection();
        recorded.queueResult({ rows: [{ acquired: 1 }] });
        recorded.queueResult();
        recorded.queueResult({ rows: [] });
        recorded.queueResult({ rows: [{ released: 1, pg_advisory_unlock: true }] });
        const database: DatabaseConnection = {
            isInTransaction: false,
            query: recorded.query.bind(recorded),
            transaction: recorded.transaction.bind(recorded),
        };
        const runner = new MigrationRunner(database, dialect);
        if (operation === 'update') await expect(runner.update([])).resolves.toMatchObject({ appliedMigrations: [] });
        else await expect(runner.getAppliedMigrations()).resolves.toEqual([]);
        expect(recorded.statements).toHaveLength(4);
        expect(recorded.statements[0]?.text).toBe(dialect.acquireMigrationLockStatement?.().text);
        expect(recorded.statements.at(-1)?.text).toBe(dialect.releaseMigrationLockStatement?.().text);
        expect(recorded.sessionEvents).toEqual([]);
    });

    it('rejects history DDL inside a caller transaction and permits a read-only check', async () => {
        const connection = new BootstrapConnection(dialect);
        const runner = new MigrationRunner(connection, dialect);
        await connection.transaction(async () => {
            await expect(runner.getAppliedMigrations()).rejects.toThrow('history initialization cannot run inside an active transaction');
            expect(connection.statements).toEqual([]);
            await expect(runner.getAppliedMigrations({ initializeHistory: false })).resolves.toEqual([]);
        });
        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]?.text).toContain('select exists');
        expect(connection.sessionEvents).toEqual([]);
    });
});
