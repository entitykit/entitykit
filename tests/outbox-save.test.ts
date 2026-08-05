import { RecordingDatabaseConnection } from '../src/testing';
import {
    createOutboxUser,
    OutboxContext,
} from './support/outbox-fixture';

describe('outbox saveChanges', () => {
    it('writes domain events in the same saveChanges transaction', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            {
                type: 'UserCreated',
                aggregateId: 'usr_1',
                payload: { userId: 'usr_1' },
            },
        ]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        const affected = await db.saveChanges();

        expect(affected).toBe(1);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        expect(connection.statements[0]?.text).toContain('insert into "outbox_users"');
        expect(connection.statements[1]?.text).toContain('insert into "app_outbox"');
        expect(connection.statements[1]?.values).toEqual([
            'UserCreated',
            '{"userId":"usr_1"}',
            'usr_1',
            new Date('2026-06-01T12:00:00.000Z'),
        ]);
        expect(user.domainEvents).toEqual([]);
    });

    it('batches multiple domain events into one outbox insert', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            {
                type: 'UserCreated',
                aggregateId: 'usr_1',
                payload: { userId: 'usr_1' },
            },
            {
                type: 'WelcomeEmailQueued',
                aggregateId: 'usr_1',
                payload: { userId: 'usr_1', template: 'welcome' },
            },
        ]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 2 });

        const affected = await db.saveChanges();

        expect(affected).toBe(1);
        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toBe(
            'insert into "app_outbox" ("type", "payload", "aggregate_id", "occurred_at") values ($1, $2, $3, $4), ($5, $6, $7, $8)',
        );
        expect(connection.statements[1]?.values).toEqual([
            'UserCreated',
            '{"userId":"usr_1"}',
            'usr_1',
            new Date('2026-06-01T12:00:00.000Z'),
            'WelcomeEmailQueued',
            '{"userId":"usr_1","template":"welcome"}',
            'usr_1',
            new Date('2026-06-01T12:00:00.000Z'),
        ]);
        expect(user.domainEvents).toEqual([]);
    });

    it('clears queued outbox save-plan work through the context clearChanges API', () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            {
                type: 'UserCreated',
                aggregateId: 'usr_1',
                payload: { userId: 'usr_1' },
            },
        ]);
        db.users.add(user);

        expect(db.getSavePlan().map(entry => entry.entityName)).toEqual([
            'OutboxUser',
            'OutboxMessage',
        ]);

        db.clearChanges();

        expect(db.getSavePlan()).toEqual([]);
        expect(user.domainEvents).toHaveLength(1);
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('rolls back and keeps events when a batched outbox insert affects too few rows', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            { type: 'UserCreated', aggregateId: 'usr_1', payload: { userId: 'usr_1' } },
            { type: 'WelcomeEmailQueued', aggregateId: 'usr_1', payload: { userId: 'usr_1' } },
        ]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).rejects.toThrow('affected 1');

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(user.domainEvents).toHaveLength(2);
    });

    it('does not clear events when saveChanges rolls back', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            { type: 'UserCreated', payload: { userId: 'usr_1' } },
        ]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueError(new Error('outbox insert failed'));

        await expect(db.saveChanges()).rejects.toThrow('outbox insert failed');

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(user.domainEvents).toHaveLength(1);
    });

    it('rolls back and keeps events when a batched outbox insert provider call fails', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            { type: 'UserCreated', payload: { userId: 'usr_1' } },
            { type: 'WelcomeEmailQueued', payload: { userId: 'usr_1' } },
        ]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueError(new Error('outbox insert failed'));

        await expect(db.saveChanges()).rejects.toThrow('outbox insert failed');

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toBe(
            'insert into "app_outbox" ("type", "payload", "aggregate_id", "occurred_at") values ($1, $2, $3, $4), ($5, $6, $7, $8)',
        );
        expect(user.domainEvents).toHaveLength(2);
    });
});
