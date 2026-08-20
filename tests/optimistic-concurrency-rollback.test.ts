import { EntityState, type SaveChangesDiagnosticEvent } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    ConcurrencyContext,
    createConcurrencyContext,
    createConcurrencyUser,
} from './support/optimistic-concurrency-fixture';

describe('optimistic concurrency rollback', () => {
    it('restores version values and retryable state after an outer rollback', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = createConcurrencyContext(connection);
        const user = createConcurrencyUser();
        db.users.attach(user);
        user.name = 'Changed';

        await expect(db.transaction(async transaction => {
            await transaction.saveChanges();
            expect(user.version).toBe(2);
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(user.version).toBe(1);
        expect(db.entry(user)?.state).toBe(EntityState.Modified);
        expect(db.entry(user)?.originalValues.version).toBe(1);
        expect(db.getSavePlan()).toHaveLength(1);
    });

    it('rolls back all concurrency-token updates when a later entity conflicts', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 0 });
        const db =  createConcurrencyContext(connection);
        const first = createConcurrencyUser();
        const second = createConcurrencyUser({
            id: 'usr_2',
            email: 'b@example.com',
            name: 'B',
            version: 4,
        });
        db.users.attach(first);
        db.users.attach(second);
        first.name = 'A2';
        second.name = 'B2';

        let thrown: unknown;
        try {
            await db.saveChanges();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toMatchObject({
            entityName: 'User',
            keyValue: 'usr_2',
            state: EntityState.Modified,
            rowCount: 0,
        });
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.statements).toHaveLength(2);
        expect(first.version).toBe(1);
        expect(second.version).toBe(4);
        expect(db.entry(first)?.state).toBe(EntityState.Modified);
        expect(db.entry(second)?.state).toBe(EntityState.Modified);
        expect(db.entry(first)?.originalValues.version).toBe(1);
        expect(db.entry(second)?.originalValues.version).toBe(4);
    });

    it('rolls back all concurrency-token deletes when a later entity conflicts', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 0 });
        const db =  createConcurrencyContext(connection);
        const first = createConcurrencyUser();
        const second = createConcurrencyUser({
            id: 'usr_2',
            email: 'b@example.com',
            name: 'B',
            version: 4,
        });
        db.users.attach(first);
        db.users.attach(second);
        db.users.remove(first);
        db.users.remove(second);

        let thrown: unknown;
        try {
            await db.saveChanges();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toMatchObject({
            entityName: 'User',
            keyValue: 'usr_2',
            state: EntityState.Deleted,
            rowCount: 0,
        });
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.statements).toHaveLength(2);
        expect(db.entry(first)?.state).toBe(EntityState.Deleted);
        expect(db.entry(second)?.state).toBe(EntityState.Deleted);
    });

    it('emits failed save diagnostics that preserve the conflicting entity metadata', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 0 });
        const db =  createConcurrencyContext(connection);
        const first = createConcurrencyUser();
        const second = createConcurrencyUser({
            id: 'usr_2',
            email: 'b@example.com',
            name: 'B',
            version: 4,
        });
        db.users.attach(first);
        db.users.attach(second);
        first.name = 'A2';
        second.name = 'B2';

        let thrown: unknown;
        try {
            await db.saveChanges();
        } catch (error) {
            thrown = error;
        }

        const saveEvent = ConcurrencyContext.events.find(
            (event): event is SaveChangesDiagnosticEvent => event.kind === 'saveChanges',
        );
        const rollbackEvent = ConcurrencyContext.events.find(
            event => event.kind === 'transaction' && event.phase === 'rollback',
        );

        expect(saveEvent).toEqual(expect.objectContaining({
            kind: 'saveChanges',
            error: thrown,
        }));
        expect(saveEvent?.affectedEntities).toBeUndefined();
        expect(saveEvent?.plan).toHaveLength(2);
        expect(saveEvent?.plan.map(entry => entry.keyValue)).toEqual(['usr_1', 'usr_2']);
        expect(saveEvent?.error).toMatchObject({
            entityName: 'User',
            keyValue: 'usr_2',
            state: EntityState.Modified,
            rowCount: 0,
        });
        expect(rollbackEvent).toEqual(expect.objectContaining({
            kind: 'transaction',
            phase: 'rollback',
            error: thrown,
        }));
    });
});
