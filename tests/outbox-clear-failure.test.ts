import { RecordingDatabaseConnection } from '../src/testing';
import {
    createOutboxUser,
    OutboxContext,
} from './support/outbox-fixture';

describe('outbox event clearing', () => {
    it('waits for asynchronous event clearing before completing the save', async () => {
        const connection = new RecordingDatabaseConnection();
        let allowClear: (() => void) | undefined;
        const clearGate: Promise<void> = new Promise(resolve => {
            allowClear = resolve;
        });
        let reportClearStarted: (() => void) | undefined;
        const clearStarted: Promise<void> = new Promise(resolve => {
            reportClearStarted = resolve;
        });
        let clearCompleted = false;
        const db = OutboxContext.createWith(connection, async (entity, events) => {
            reportClearStarted?.();
            await clearGate;
            const persisted = new Set(events);
            const user = entity as ReturnType<typeof createOutboxUser>;
            user.domainEvents = user.domainEvents.filter(event => !persisted.has(event));
            clearCompleted = true;
        });
        const user = createOutboxUser([{
            type: 'UserCreated',
            payload: { userId: 'usr_1' },
        }]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        let saveCompleted = false;
        const save = db.saveChanges().then(result => {
            saveCompleted = true;
            return result;
        });
        await clearStarted;

        expect(saveCompleted).toBe(false);
        expect(clearCompleted).toBe(false);
        allowClear?.();
        await expect(save).resolves.toBe(1);
        await expect(db.saveChanges()).resolves.toBe(0);

        expect(clearCompleted).toBe(true);
        expect(user.domainEvents).toEqual([]);
        expect(connection.statements).toHaveLength(2);
    });

    it('suppresses a committed event after clearEvents fails', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = OutboxContext.createWith(connection, () => {
            throw new Error('clear failed');
        });
        const user = createOutboxUser([{
            type: 'UserCreated',
            payload: { userId: 'usr_1' },
        }]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(db.saveChanges()).resolves.toBe(0);

        expect(user.domainEvents).toHaveLength(1);
        expect(connection.statements).toHaveLength(2);
    });

    it('keeps a committed event suppressed after asynchronous clearing rejects', async () => {
        const connection = new RecordingDatabaseConnection();
        let clearFinished = false;
        const db = OutboxContext.createWith(connection, async () => {
            await Promise.resolve();
            clearFinished = true;
            throw new Error('async clear failed');
        });
        const user = createOutboxUser([{
            type: 'UserCreated',
            payload: { userId: 'usr_1' },
        }]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(db.saveChanges()).resolves.toBe(0);

        expect(clearFinished).toBe(true);
        expect(user.domainEvents).toHaveLength(1);
        expect(connection.statements).toHaveLength(2);
    });

    it('still persists events raised after asynchronous clearing rejects', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = OutboxContext.createWith(connection, async () => {
            await Promise.resolve();
            throw new Error('async clear failed');
        });
        const user = createOutboxUser([{
            type: 'UserCreated',
            payload: { userId: 'usr_1' },
        }]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        await db.saveChanges();

        user.domainEvents.push({
            type: 'WelcomeRequested',
            payload: { userId: 'usr_1' },
        });
        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(db.saveChanges()).resolves.toBe(0);

        expect(user.domainEvents).toHaveLength(2);
        expect(connection.statements
            .filter(statement => statement.text.includes('insert into "app_outbox"'))
            .map(statement => statement.values[0]))
            .toEqual(['UserCreated', 'WelcomeRequested']);
    });
});
