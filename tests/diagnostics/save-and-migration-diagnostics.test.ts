import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
    DbUpdateConcurrencyError,
    type MigrationDiagnosticEvent,
    type SaveChangesDiagnosticEvent,
    TransactionOutcomeUnknownError,
} from '../../packages/core/src';
import { DbContextOptionsBuilder } from '../../packages/core/src/core/context-options/db-context-options-builder';
import { contextMigrations } from '../../packages/core/src/migrations/api';
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
            durability: 'committed',
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
            durability: 'failed',
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
            durability: 'failed',
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

    it.each([
        {
            label: 'a direct unknown commit outcome',
            failure: (): Error => unknownCommitError(),
        },
        {
            label: 'an unknown outcome beneath cleanup failure',
            failure: (): Error => new DatabaseTransactionCleanupError(
                'postgres',
                unknownCommitError(),
                new DatabaseProviderError(
                    'Postgres rollback failed.',
                    undefined,
                    { provider: 'postgres', operation: 'rollback' },
                ),
            ),
        },
    ])('marks $label with unknown durability', async ({ failure: createFailure }) => {
        const db = DiagnosticsContext.create();
        const user = new User();
        user.id = 'usr_1';
        const failure = createFailure();

        db.users.add(user);
        DiagnosticsContext.connection.queueResult({ rowCount: 1 });
        DiagnosticsContext.connection.failNextTransactionCommit(failure);

        await expect(db.saveChanges()).rejects.toBe(failure);

        const saveEvent = DiagnosticsContext.events.find(
            (event): event is SaveChangesDiagnosticEvent =>
                event.kind === 'saveChanges',
        );
        expect(saveEvent).toEqual(containing({
            durability: 'unknown',
            error: failure,
        }));
    });

    it('marks saves as pending until an explicit outer transaction commits', async () => {
        const db = DiagnosticsContext.create();
        const user = new User();
        user.id = 'usr_1';
        DiagnosticsContext.connection.queueResult({ rowCount: 1 });

        await db.transaction(async transaction => {
            transaction.users.add(user);
            await transaction.saveChanges();

            const saveEvent = DiagnosticsContext.events.find(
                (event): event is SaveChangesDiagnosticEvent =>
                    event.kind === 'saveChanges',
            );
            expect(saveEvent?.durability).toBe('pendingTransaction');
            expect(DiagnosticsContext.events).not.toEqual(arrayContaining([
                containing({ kind: 'transaction', phase: 'commit' }),
            ]));
        });

        expect(DiagnosticsContext.events).toEqual(arrayContaining([
            containing({ kind: 'transaction', phase: 'commit' }),
        ]));
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

function unknownCommitError(): TransactionOutcomeUnknownError {
    return new TransactionOutcomeUnknownError(
        'postgres',
        new DatabaseProviderError(
            'Postgres commit failed.',
            undefined,
            { provider: 'postgres', operation: 'commit' },
        ),
    );
}
