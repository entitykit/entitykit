import { MigrationRunner, migrationChecksum, postgresMigrationDialect } from '../../src/migrations/api';
import {
    arrayContaining,
    containing,
    stringContaining,
} from '../support/jest-asymmetric-matchers';
import { AddPosts, CreateUsers, migrationDiagnostics, migrationEvents, RecordingDatabaseConnection } from './support';

describe('migration history validation', () => {
    it('fails when applied migration history is missing from local migrations', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [{ id: '20260601110000_Missing', name: 'Missing', checksum: 'abc' }] });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection).update([new CreateUsers()]))
            .rejects.toMatchObject({
                name: 'MigrationError',
                message: stringContaining('Restore the missing migration file'),
            });
    });

    it('emits migration diagnostics when database history references a missing local migration', async () => {
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [{ id: '20260601110000_Missing', name: 'Missing', checksum: 'abc' }] });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options).update([new CreateUsers()]))
            .rejects.toMatchObject({ name: 'MigrationError' });

        expect(migrationEvents(diagnostics.events)).toEqual(arrayContaining([
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'historyValidationFailure',
                migrationId: '20260601110000_Missing',
                error: containing({
                    name: 'MigrationError',
                    details: containing({
                        driftKind: 'missingLocalMigration',
                        nextAction: stringContaining('Restore the missing migration file'),
                    }),
                }),
            }),
        ]));
    });

    it('fails closed when applied migration history contains duplicate rows', async () => {
        const createUsers = new CreateUsers();
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({
            rows: [
                { id: createUsers.id, name: createUsers.name, checksum: migrationChecksum(createUsers) },
                { id: createUsers.id, name: createUsers.name, checksum: migrationChecksum(createUsers) },
            ],
        });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options).update([createUsers]))
            .rejects.toMatchObject({
                name: 'MigrationError',
                message: stringContaining('appears more than once'),
                details: containing({
                    migrationId: createUsers.id,
                    driftKind: 'duplicateAppliedMigration',
                    nextAction: stringContaining('remove the duplicate history row'),
                }),
            });

        expect(connection.transactionEvents).toEqual([]);
        expect(migrationEvents(diagnostics.events)).toEqual(arrayContaining([
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'historyValidationFailure',
                migrationId: createUsers.id,
                error: containing({
                    details: containing({
                        driftKind: 'duplicateAppliedMigration',
                    }),
                }),
            }),
        ]));
    });

    it('fails closed when applied migration history is not ordered', async () => {
        const createUsers = new CreateUsers();
        const addPosts = new AddPosts();
        const connection = new RecordingDatabaseConnection();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({
            rows: [
                { id: addPosts.id, name: addPosts.name, checksum: migrationChecksum(addPosts) },
                { id: createUsers.id, name: createUsers.name, checksum: migrationChecksum(createUsers) },
            ],
        });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection).update([createUsers, addPosts]))
            .rejects.toMatchObject({
                name: 'MigrationError',
                message: stringContaining('not ordered by id'),
                details: containing({
                    migrationId: createUsers.id,
                    previousMigrationId: addPosts.id,
                    driftKind: 'outOfOrderAppliedHistory',
                    nextAction: stringContaining('provider migration history query'),
                }),
            });

        expect(connection.transactionEvents).toEqual([]);
        expect(connection.statements.map(statement => statement.text)).not.toContain('drop table if exists "posts"');
    });
});
