import { MigrationDataLossError } from '../../src/migrations/api';
import { type ModelSnapshot } from '../../src/tooling';
import type { MigrationBuilder } from '../../src/migrations/api';
import { Migration, MigrationRunner, postgresMigrationDialect } from '../../src/migrations/api';
import { ConcurrentIndex, migrationDiagnostics, migrationEvents, RecordingDatabaseConnection } from './support';

describe('migration update safety and transaction boundaries', () => {
    it('blocks destructive migrations unless data loss is allowed', async () => {
        const previousSnapshot: ModelSnapshot = {
            formatVersion: 1,
            entities: [{
                entityName: 'User',
                tableName: 'users',
                keyProperty: 'id',
                properties: [{ propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, isConcurrencyToken: false, isVersion: false, hasConverter: false }],
                ignoredProperties: [],
                indexes: [],
                relationships: [],
                manyToManyRelationships: [],
            }],
        };
        const targetSnapshot: ModelSnapshot = { formatVersion: 1, entities: [] };
        class DropUsers extends Migration {
            public readonly id = '20260601130000_DropUsers';
            public readonly name = 'DropUsers';
            public override readonly previousSnapshot = previousSnapshot;
            public override readonly targetSnapshot = targetSnapshot;
            public override up(builder: MigrationBuilder): void {
                builder.dropTable('users');
            }
        }

        const connection = new RecordingDatabaseConnection();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        await expect(new MigrationRunner(connection).update([new DropUsers()]))
            .rejects.toBeInstanceOf(MigrationDataLossError);
    });

    it('keeps normal statements transactional around transaction-suppressed operations', async () => {
        const connection = new RecordingDatabaseConnection();
        const diagnostics = migrationDiagnostics();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [] });
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult();
        connection.queueResult({ rows: [{ pg_advisory_unlock: true }] });

        const result = await new MigrationRunner(connection, postgresMigrationDialect, undefined, diagnostics.options)
            .update([new ConcurrentIndex()]);

        expect(result.appliedMigrations).toEqual(['up:20260601140000_ConcurrentIndex']);
        expect(result.usedMigrationLock).toBe(true);
        expect(result.transactionSuppressedStatements).toBe(1);
        expect(connection.transactionEvents).toEqual(['begin', 'commit', 'begin', 'commit']);
        expect(connection.statements.map(statement => statement.text)).toEqual([
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select pg_advisory_lock(hashtext($1))',
            'create table if not exists "__entitykit_migrations" ("id" text primary key, "name" text not null, "checksum" text not null, "entitykit_version" text not null, "applied_at" timestamptz not null default now())',
            'select "id", "name", "checksum", "entitykit_version", "applied_at" from "__entitykit_migrations" order by "id"',
            'alter table "users" add column "email" text not null',
            'create index concurrently if not exists "ix_users_email" on "users" ("email")',
            'alter table "users" add column "name" text not null',
            'insert into "__entitykit_migrations" ("id", "name", "checksum", "entitykit_version") values ($1, $2, $3, $4)',
            'select pg_advisory_unlock(hashtext($1))',
        ]);
        expect(migrationEvents(diagnostics.events)).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'migration',
                provider: 'postgres',
                phase: 'apply',
                migrationId: '20260601140000_ConcurrentIndex',
                statementCount: 4,
                transactionSuppressedStatements: 1,
            }),
        ]));
    });
});
