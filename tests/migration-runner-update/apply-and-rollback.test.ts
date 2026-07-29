import { MigrationRunner, migrationChecksum, postgresMigrationDialect } from '../../src/migrations/api';
import {
    anyNumber,
    arrayContaining,
    containing,
} from '../support/jest-asymmetric-matchers';
import { AddPosts, CreateUsers, migrationDiagnostics, migrationEvents, RecordingDatabaseConnection } from './support';

describe('migration update apply and rollback', () => {
    it('maps database history columns to camel-cased SDK fields', async () => {
        const connection = new RecordingDatabaseConnection();
        const appliedAt = new Date('2026-06-01T00:00:00.000Z');
        connection.queueResult();
        connection.queueResult({
            rows: [{
                id: '20260601120000_CreateUsers',
                name: 'CreateUsers',
                checksum: 'abc123',
                entitykit_version: '0.1.0-alpha.1',
                applied_at: appliedAt,
            }],
        });

        await expect(new MigrationRunner(connection).getAppliedMigrations())
            .resolves.toEqual([{
                id: '20260601120000_CreateUsers',
                name: 'CreateUsers',
                checksum: 'abc123',
                entityKitVersion: '0.1.0-alpha.1',
                appliedAt,
            }]);
    });

    it('acquires an advisory lock and applies unapplied migrations', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult(); // ensure history table before lock
        connection.queueResult(); // acquire lock
        connection.queueResult(); // ensure history table in getAppliedMigrations
        connection.queueResult({ rows: [] }); // history rows
        connection.queueResult(); // insert table statement inside transaction
        connection.queueResult({ rowCount: 1 }); // insert history statement inside transaction
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] }); // release lock

        const result = await new MigrationRunner(connection).update([new CreateUsers()]);

        expect(result.appliedMigrations).toEqual(['up:20260601120000_CreateUsers']);
        expect(result.usedMigrationLock).toBe(true);
        expect(result.transactionSuppressedStatements).toBe(0);
        expect(connection.statements.map(statement => statement.text)).toContain('select pg_advisory_lock(hashtext($1))');
        expect(connection.statements.map(statement => statement.text)).toContain('select pg_advisory_unlock(hashtext($1))');
        expect(connection.sessionEvents).toEqual(['start', 'end']);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('does not open a transaction when all local migrations are already applied', async () => {
        const createUsers = new CreateUsers();
        const connection = new RecordingDatabaseConnection();
        connection.queueResult(); // ensure history table before lock
        connection.queueResult(); // acquire lock
        connection.queueResult(); // ensure history table in getAppliedMigrations
        connection.queueResult({
            rows: [{ id: createUsers.id, name: createUsers.name, checksum: migrationChecksum(createUsers) }],
        });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] }); // release lock

        const result = await new MigrationRunner(connection).update([createUsers]);

        expect(result.appliedMigrations).toEqual([]);
        expect(result.usedMigrationLock).toBe(true);
        expect(result.transactionSuppressedStatements).toBe(0);
        expect(connection.transactionEvents).toEqual([]);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select pg_advisory_lock(hashtext($1))',
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select "id", "name", "checksum", "entitykit_version", "applied_at" from "__entitykit_migrations" order by "id"',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
    });

    it('emits migration diagnostics while applying pending migrations', async () => {
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await new MigrationRunner(
            connection,
            postgresMigrationDialect,
            undefined,
            diagnostics.options,
        ).update([new CreateUsers()]);

        expect(migrationEvents(diagnostics.events)).toEqual([
            containing({ kind: 'migration', provider: 'postgres', phase: 'discovery', migrationCount: 1, durationMs: anyNumber() }),
            containing({ kind: 'migration', provider: 'postgres', phase: 'lockAcquire', durationMs: anyNumber() }),
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'pending',
                migrationCount: 1,
                pendingMigrations: ['up:20260601120000_CreateUsers'],
                target: 'Latest',
            }),
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'apply',
                migrationId: '20260601120000_CreateUsers',
                migrationName: 'CreateUsers',
                direction: 'up',
                durationMs: anyNumber(),
            }),
            containing({ kind: 'migration', provider: 'postgres', phase: 'lockRelease', durationMs: anyNumber() }),
        ]);
    });

    it('rolls back applied migrations when targeting an earlier migration', async () => {
        const createUsers = new CreateUsers();
        const addPosts = new AddPosts();
        const connection = new RecordingDatabaseConnection();
        connection.queueResult(); // ensure history table before lock
        connection.queueResult(); // acquire lock
        connection.queueResult(); // ensure history table in getAppliedMigrations
        connection.queueResult({
            rows: [
                { id: createUsers.id, name: createUsers.name, checksum: migrationChecksum(createUsers) },
                { id: addPosts.id, name: addPosts.name, checksum: migrationChecksum(addPosts) },
            ],
        });
        connection.queueResult(); // drop posts inside transaction
        connection.queueResult({ rowCount: 1 }); // delete history inside transaction
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] }); // release lock

        const result = await new MigrationRunner(connection).update([createUsers, addPosts], { target: createUsers.id });

        expect(result.appliedMigrations).toEqual(['down:20260601130000_AddPosts']);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select pg_advisory_lock(hashtext($1))',
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select "id", "name", "checksum", "entitykit_version", "applied_at" from "__entitykit_migrations" order by "id"',
            'drop table if exists "posts"',
            'delete from "__entitykit_migrations" where "id" = $1',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
        expect(connection.statements[5]?.values).toEqual([addPosts.id]);
    });

    it('emits migration diagnostics while rolling back migrations', async () => {
        const createUsers = new CreateUsers();
        const addPosts = new AddPosts();
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({
            rows: [
                { id: createUsers.id, name: createUsers.name, checksum: migrationChecksum(createUsers) },
                { id: addPosts.id, name: addPosts.name, checksum: migrationChecksum(addPosts) },
            ],
        });
        connection.queueResult();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options)
            .update([createUsers, addPosts], { target: createUsers.id });

        expect(migrationEvents(diagnostics.events)).toEqual(arrayContaining([
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'pending',
                migrationCount: 1,
                pendingMigrations: ['down:20260601130000_AddPosts'],
                target: createUsers.id,
            }),
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'rollback',
                migrationId: addPosts.id,
                migrationName: addPosts.name,
                direction: 'down',
                durationMs: anyNumber(),
            }),
        ]));
    });
});
