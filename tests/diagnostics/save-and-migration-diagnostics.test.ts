import {
    DbUpdateConcurrencyError,
    type MigrationDiagnosticEvent,
    type SaveChangesDiagnosticEvent,
} from '../../src';
import { DbContextOptionsBuilder } from '../../src/core/context-options/db-context-options-builder';
import { contextMigrations } from '../../src/migrations/api';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import {
    anyNumber,
    arrayContaining,
    containing,
} from '../support/jest-asymmetric-matchers';
import {
    DiagnosticsContext,
    DiagnosticsMigration,
    resetDiagnosticsContext,
    User,
} from './diagnostics-test-support';

describe('save and migration diagnostics', () => {
    beforeEach(resetDiagnosticsContext);

    it('emits saveChanges diagnostics with batched affected-row context', async () => {
        const db =  DiagnosticsContext.create();
        const first = new User();
        first.id = 'usr_1';
        const second = new User();
        second.id = 'usr_2';

        db.users.add(first);
        db.users.add(second);
        DiagnosticsContext.connection.queueResult({ rowCount: 2 });

        await expect(db.saveChanges()).resolves.toBe(2);

        const saveEvent = DiagnosticsContext.events.find(
            (event): event is SaveChangesDiagnosticEvent => event.kind === 'saveChanges',
        );

        expect(saveEvent).toEqual(containing({
            kind: 'saveChanges',
            provider: 'diagnostic-test',
            durationMs: anyNumber(),
            affectedEntities: 2,
        }));
        expect(saveEvent?.plan).toHaveLength(1);
        expect(saveEvent?.plan[0]).toMatchObject({
            entityName: 'User',
            affectedEntityCount: 2,
            expectedAffectedRows: 2,
            state: 'Added',
        });
    });

    it('emits failed saveChanges diagnostics with the mapped save error', async () => {
        const db =  DiagnosticsContext.create();
        const first = new User();
        first.id = 'usr_1';
        const second = new User();
        second.id = 'usr_2';
        const failure = new Error('database failed');

        db.users.add(first);
        db.users.add(second);
        DiagnosticsContext.connection.queueError(failure);

        await expect(db.saveChanges()).rejects.toBe(failure);

        const saveEvent = DiagnosticsContext.events.find(
            (event): event is SaveChangesDiagnosticEvent => event.kind === 'saveChanges',
        );

        expect(saveEvent).toEqual(containing({
            kind: 'saveChanges',
            provider: 'diagnostic-test',
            durationMs: anyNumber(),
            error: failure,
        }));
        expect(saveEvent?.affectedEntities).toBeUndefined();
        expect(saveEvent?.plan).toHaveLength(1);
        expect(saveEvent?.plan[0]).toMatchObject({
            entityName: 'User',
            affectedEntityCount: 2,
            expectedAffectedRows: 2,
            state: 'Added',
        });
    });

    it('emits failed saveChanges diagnostics with the row-count concurrency error', async () => {
        const db =  DiagnosticsContext.create();
        const first = new User();
        first.id = 'usr_1';
        const second = new User();
        second.id = 'usr_2';
        let thrown: unknown;

        db.users.add(first);
        db.users.add(second);
        DiagnosticsContext.connection.queueResult({ rowCount: 1 });

        try {
            await db.saveChanges();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(DbUpdateConcurrencyError);
        const saveEvent = DiagnosticsContext.events.find(
            (event): event is SaveChangesDiagnosticEvent => event.kind === 'saveChanges',
        );
        const rollbackEvent = DiagnosticsContext.events.find(
            event => event.kind === 'transaction' && event.phase === 'rollback',
        );

        expect(saveEvent).toEqual(containing({
            kind: 'saveChanges',
            provider: 'diagnostic-test',
            durationMs: anyNumber(),
            error: thrown,
        }));
        expect(saveEvent?.plan[0]).toMatchObject({
            entityName: 'User',
            affectedEntityCount: 2,
            expectedAffectedRows: 2,
            state: 'Added',
        });
        expect(rollbackEvent).toEqual(containing({
            kind: 'transaction',
            phase: 'rollback',
            error: thrown,
        }));
    });

    it('emits migration diagnostics through DbContext updateDatabase', async () => {
        const db =  DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult();
        DiagnosticsContext.connection.queueResult();
        DiagnosticsContext.connection.queueResult();
        DiagnosticsContext.connection.queueResult({ rows: [] });
        DiagnosticsContext.connection.queueResult();
        DiagnosticsContext.connection.queueResult({ rowCount: 1 });
        DiagnosticsContext.connection.queueResult({
            rows: [{ pg_advisory_unlock: true }],
        });

        await contextMigrations(db).update([new DiagnosticsMigration()]);

        const migrationEvents = DiagnosticsContext.events.filter(
            (event): event is MigrationDiagnosticEvent => event.kind === 'migration',
        );

        expect(migrationEvents).toEqual(arrayContaining([
            containing({
                kind: 'migration',
                provider: 'diagnostic-test',
                phase: 'pending',
                pendingMigrations: ['up:20260601120000_DiagnosticsMigration'],
            }),
            containing({
                kind: 'migration',
                provider: 'diagnostic-test',
                phase: 'apply',
                migrationId: '20260601120000_DiagnosticsMigration',
                migrationName: 'DiagnosticsMigration',
                direction: 'up',
            }),
        ]));
    });

    it('leaves the configured connection unchanged when diagnostics are disabled', () => {
        const connection = new RecordingDatabaseConnection();

        const options = new DbContextOptionsBuilder()
            .useConnection(connection)
            .build();

        expect(options.connection).toBe(connection);
        expect(options.diagnostics).toEqual([]);
    });
});
