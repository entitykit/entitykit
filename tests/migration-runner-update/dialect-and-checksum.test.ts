import {
    Migration,
    MigrationBuilder,
    MigrationRunner,
    MigrationSqlGenerator,
    migrationChecksum,
    postgresMigrationDialect,
} from '../../src/migrations/api';
import {
    arrayContaining,
    containing,
    stringContaining,
} from '../support/jest-asymmetric-matchers';
import { CreateUsers, migrationDiagnostics, migrationEvents, noLockMigrationDialect, RecordingDatabaseConnection } from './support';

describe('migration update dialect and checksums', () => {
    it('uses the configured migration dialect for history SQL and optional locking', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult(); // ensure history table before optional lock
        connection.queueResult(); // ensure history table in getAppliedMigrations
        connection.queueResult({ rows: [] }); // history rows
        connection.queueResult(); // create users inside transaction
        connection.queueResult({ rowCount: 1 }); // insert custom history inside transaction

        const result = await new MigrationRunner(connection, noLockMigrationDialect).update([new CreateUsers()]);

        expect(result.appliedMigrations).toEqual(['up:20260601120000_CreateUsers']);
        expect(result.usedMigrationLock).toBe(false);
        expect(result.transactionSuppressedStatements).toBe(0);
        expect(connection.sessionEvents).toEqual(['start', 'end']);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'create table if not exists [migrations] ([id] text primary key, [name] text not null, [checksum] text not null, [entitykit_version] text not null)',
            'create table if not exists [migrations] ([id] text primary key, [name] text not null, [checksum] text not null, [entitykit_version] text not null)',
            'select [id], [name], [checksum], [entitykit_version] from [migrations] order by [id]',
            'create table if not exists [users] ([id] uuid primary key)',
            'insert into [migrations] ([id], [name], [checksum], [entitykit_version]) values (?, ?, ?, ?)',
        ]);
        expect(connection.statements.map(statement => statement.text)).not.toContain('select pg_advisory_lock(hashtext($1))');
        expect(connection.statements[4]?.values.slice(0, 2)).toEqual([new CreateUsers().id, new CreateUsers().name]);
    });

    it('uses the configured migration dialect when generating scripts', () => {
        const script = new MigrationSqlGenerator(noLockMigrationDialect).generateUpScript(new CreateUsers());

        expect(script).toContain('create table if not exists [migrations]');
        expect(script).toContain('create table if not exists [users] ([id] uuid primary key);');
        expect(script).toContain('insert into [migrations] ([id], [name], [checksum], [entitykit_version]) values (\'20260601120000_CreateUsers\', \'CreateUsers\'');
        expect(script).not.toContain('pg_advisory_lock');
    });

    it('detects checksum mismatches for already applied migrations', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [{ id: '20260601120000_CreateUsers', name: 'CreateUsers', checksum: 'bad' }] });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection).update([new CreateUsers()]))
            .rejects.toMatchObject({
                name: 'MigrationChecksumError',
                message: stringContaining('Restore the exact applied migration file'),
            });
    });

    it('emits migration diagnostics for checksum mismatches', async () => {
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [{ id: '20260601120000_CreateUsers', name: 'CreateUsers', checksum: 'bad' }] });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options).update([new CreateUsers()]))
            .rejects.toMatchObject({ name: 'MigrationChecksumError' });

        expect(migrationEvents(diagnostics.events)).toEqual(arrayContaining([
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'checksumFailure',
                migrationId: '20260601120000_CreateUsers',
                error: containing({
                    name: 'MigrationChecksumError',
                    details: containing({
                        driftKind: 'checksumMismatch',
                        nextAction: stringContaining('Restore the exact applied migration file'),
                    }),
                }),
            }),
            containing({ kind: 'migration', provider: 'postgres', phase: 'lockRelease' }),
        ]));
    });

    it('validates checksums with the configured provider builder', async () => {
        class ExtensionMigration extends Migration {
            public readonly id = '20260729000002_Extension';
            public readonly name = 'Extension';
            public override up(builder: MigrationBuilder): void {
                builder.createExtension('citext');
            }
            public override down(builder: MigrationBuilder): void {
                builder.dropExtension('citext');
            }
        }
        const migration = new ExtensionMigration();
        const createBuilder = (): MigrationBuilder => new MigrationBuilder(
            postgresMigrationDialect.sql,
            {
                providerName: 'postgres',
                supportsExtensions: true,
            },
        );
        const expectedChecksum = migrationChecksum(
            migration,
            postgresMigrationDialect.sql,
            createBuilder,
        );
        const upStatements = new MigrationSqlGenerator(
            postgresMigrationDialect,
            createBuilder,
        ).buildUpStatements(migration);
        expect(upStatements.at(-1)?.values[2]).toBe(expectedChecksum);

        const connection = new RecordingDatabaseConnection();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({
            rows: [{
                id: migration.id,
                name: migration.name,
                checksum: expectedChecksum,
            }],
        });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(
            connection,
            postgresMigrationDialect,
            createBuilder,
        ).update([migration])).resolves.toMatchObject({ appliedMigrations: [] });
    });

    it('computes stable migration checksums', () => {
        expect(migrationChecksum(new CreateUsers())).toMatch(/^[a-f0-9]{64}$/);
        expect(migrationChecksum(new CreateUsers())).toBe(migrationChecksum(new CreateUsers()));
    });
});
