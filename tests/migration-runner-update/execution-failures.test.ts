import { MigrationRunner, postgresMigrationDialect } from '../../src/migrations/api';
import {
    arrayContaining,
    containing,
    stringContaining,
} from '../support/jest-asymmetric-matchers';
import { CreateUsers, FailsAfterTransactionSuppressedStatement, FailsInsideTransaction, migrationDiagnostics, migrationEvents, RecordingDatabaseConnection } from './support';

describe('migration update execution failures', () => {
    it('wraps transactional migration failures with recovery details and leaves history unchanged', async () => {
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        const failure = new Error('statement failed');
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult();
        connection.queueError(failure);
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options).update([new FailsInsideTransaction()]))
            .rejects.toMatchObject({
                name: 'MigrationExecutionError',
                cause: failure,
                details: containing({
                    migrationId: '20260601150000_FailsInsideTransaction',
                    migrationName: 'FailsInsideTransaction',
                    phase: 'apply',
                    direction: 'up',
                    statementCount: 3,
                    transactionSuppressedStatements: 0,
                    transactionMode: 'transactional statements',
                    nextAction: stringContaining('Run db status'),
                }),
            });

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select pg_advisory_lock(hashtext($1))',
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select "id", "name", "checksum", "entitykit_version", "applied_at" from "__entitykit_migrations" order by "id"',
            'select before_failure',
            'select fail_inside_transaction',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
        expect(connection.statements.map(statement => statement.text)).not.toContain('insert into "__entitykit_migrations" ("id", "name", "checksum", "entitykit_version") values ($1, $2, $3, $4)');
        expect(migrationEvents(diagnostics.events)).toEqual(arrayContaining([
            containing({
                kind: 'migration',
                provider: 'postgres',
                phase: 'apply',
                migrationId: '20260601150000_FailsInsideTransaction',
                statementCount: 3,
                transactionSuppressedStatements: 0,
                error: containing({
                    name: 'MigrationExecutionError',
                    cause: failure,
                }),
            }),
            containing({ kind: 'migration', provider: 'postgres', phase: 'lockRelease' }),
        ]));
    });

    it('wraps failed migration history writes with recovery details', async () => {
        const createUsers = new CreateUsers();
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('history insert failed');
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult();
        connection.queueError(failure);
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection).update([createUsers]))
            .rejects.toMatchObject({
                name: 'MigrationExecutionError',
                cause: failure,
                message: stringContaining(createUsers.id),
                details: containing({
                    migrationId: createUsers.id,
                    migrationName: createUsers.name,
                    phase: 'apply',
                    direction: 'up',
                    statementCount: 2,
                    transactionSuppressedStatements: 0,
                    nextAction: stringContaining('Run db status'),
                }),
            });

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select pg_advisory_lock(hashtext($1))',
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select "id", "name", "checksum", "entitykit_version", "applied_at" from "__entitykit_migrations" order by "id"',
            'create table if not exists "users" ("id" uuid primary key)',
            'insert into "__entitykit_migrations" ("id", "name", "checksum", "entitykit_version") values ($1, $2, $3, $4)',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
    });

    it('wraps failures after transaction-suppressed statements with partial-recovery guidance', async () => {
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('post-suppressed statement failed');
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult();
        connection.queueResult();
        connection.queueError(failure);
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection).update([new FailsAfterTransactionSuppressedStatement()]))
            .rejects.toMatchObject({
                name: 'MigrationExecutionError',
                cause: failure,
                message: stringContaining('transaction-suppressed'),
                details: containing({
                    migrationId: '20260601160000_FailsAfterTransactionSuppressedStatement',
                    phase: 'apply',
                    statementCount: 4,
                    transactionSuppressedStatements: 1,
                    transactionMode: 'mixed transactional and transaction-suppressed statements',
                    nextAction: stringContaining('inspect the database for partial transaction-suppressed work'),
                }),
            });

        expect(connection.transactionEvents).toEqual(['begin', 'commit', 'begin', 'rollback']);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select pg_advisory_lock(hashtext($1))',
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select "id", "name", "checksum", "entitykit_version", "applied_at" from "__entitykit_migrations" order by "id"',
            'select before_suppressed',
            'create index concurrently ix_users_email on users (email)',
            'select fail_after_suppressed',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
        expect(connection.statements.map(statement => statement.text)).not.toContain('insert into "__entitykit_migrations" ("id", "name", "checksum", "entitykit_version") values ($1, $2, $3, $4)');
    });
});
