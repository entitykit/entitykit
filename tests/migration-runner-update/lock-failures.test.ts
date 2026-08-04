import { MigrationRunner, postgresMigrationDialect } from '../../src/migrations/api';
import {
    arrayContaining,
    containing,
    stringContaining,
} from '../support/jest-asymmetric-matchers';
import { CreateUsers, migrationDiagnostics, migrationEvents, RecordingDatabaseConnection } from './support';

describe('migration update lock failures', () => {
    it('ignores a diagnostic handler that throws after lock acquisition', async () => {
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('diagnostic failed');
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(
            connection,
            postgresMigrationDialect,
            undefined,
            {
                provider: 'postgres',
                diagnostics: [event => {
                    if (
                        event.phase === 'lockAcquire' &&
                        !event.error
                    ) {
                        throw failure;
                    }
                }],
            },
        ).update([])).resolves.toMatchObject({ appliedMigrations: [] });

        expect(connection.statements.map(statement => statement.text)).toEqual([
            stringContaining('create table if not exists'),
            'select pg_advisory_lock(hashtext($1))',
            stringContaining('create table if not exists'),
            stringContaining('select "id", "name", "checksum"'),
            'select pg_advisory_unlock(hashtext($1))',
        ]);
        expect(connection.sessionEvents).toEqual(['start', 'end']);
    });

    it('emits migration diagnostics for migration lock failures', async () => {
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        const failure = new Error('lock failed');
        connection.queueResult();
        connection.queueError(failure);

        await expect(new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options).update([new CreateUsers()]))
            .rejects.toBe(failure);

        expect(migrationEvents(diagnostics.events)).toEqual([
            containing({ kind: 'migration', provider: 'postgres', phase: 'discovery', migrationCount: 1 }),
            containing({ kind: 'migration', provider: 'postgres', phase: 'lockAcquire', error: failure }),
        ]);
    });

    it('emits migration diagnostics for migration lock release failures', async () => {
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        const failure = new Error('unlock failed');
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult();
        connection.queueResult({ rowCount: 1 });
        connection.queueError(failure);

        await expect(new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options).update([new CreateUsers()]))
            .rejects.toBe(failure);

        expect(migrationEvents(diagnostics.events)).toEqual(arrayContaining([
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'apply',
                migrationId: '20260601120000_CreateUsers',
            }),
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'lockRelease',
                error: failure,
            }),
        ]));
    });

    it('preserves the migration failure when lock release cleanup also fails', async () => {
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        const migrationFailure = new Error('create table failed');
        const releaseFailure = new Error('unlock failed');
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueError(migrationFailure);
        connection.queueError(releaseFailure);

        await expect(new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options).update([new CreateUsers()]))
            .rejects.toMatchObject({
                name: 'MigrationLockReleaseError',
                primaryError: containing({
                    name: 'MigrationExecutionError',
                    cause: migrationFailure,
                }),
                releaseError: releaseFailure,
            });

        expect(migrationEvents(diagnostics.events)).toEqual(arrayContaining([
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'apply',
                migrationId: '20260601120000_CreateUsers',
                error: containing({
                    name: 'MigrationExecutionError',
                    cause: migrationFailure,
                }),
            }),
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'lockRelease',
                error: releaseFailure,
            }),
        ]));
    });
});
