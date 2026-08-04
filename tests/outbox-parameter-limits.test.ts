import type { OutboxMessage } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from '../src/testing';
import {
    createOutboxUser,
    type DomainEvent,
    OutboxContext,
    type OutboxUser,
} from './support/outbox-fixture';

const limitedDialect = {
    ...postgresDialect,
    name: 'limited-outbox',
    maxStatementParameters: () => 8,
};

function events(count: number): DomainEvent[] {
    return Array.from({ length: count }, (_, index) => ({
        type: `Event${String(index + 1)}`,
        aggregateId: 'usr_1',
        payload: { index },
    }));
}

function clearRecorder(batchSizes: number[]): (
    entity: object,
    persistedEvents: readonly OutboxMessage[],
) => void {
    return (entity, persistedEvents): void => {
        batchSizes.push(persistedEvents.length);
        const user = entity as OutboxUser;
        const persisted = new Set(persistedEvents);
        user.domainEvents = user.domainEvents.filter(event => !persisted.has(event));
    };
}

describe('outbox statement parameter limits', () => {
    it('splits outbox messages into provider-legal statements', async () => {
        const connection = new RecordingDatabaseConnection();
        const clearedBatchSizes: number[] = [];
        const db = OutboxContext.createWith(
            connection,
            clearRecorder(clearedBatchSizes),
            limitedDialect,
        );
        const user = createOutboxUser(events(5));
        db.users.attach(user);
        connection.queueResult({ rowCount: 2 });
        connection.queueResult({ rowCount: 2 });
        connection.queueResult({ rowCount: 1 });

        expect(db.getSavePlan().map(entry => entry.expectedAffectedRows))
            .toEqual([2, 2, 1]);
        expect(await db.saveChanges()).toBe(0);

        expect(connection.statements.map(statement => statement.values.length))
            .toEqual([8, 8, 4]);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        expect(clearedBatchSizes).toEqual([2, 2, 1]);
        expect(user.domainEvents).toEqual([]);
    });

    it('rolls every chunk back when a later outbox statement fails', async () => {
        const connection = new RecordingDatabaseConnection();
        const clearedBatchSizes: number[] = [];
        const db = OutboxContext.createWith(
            connection,
            clearRecorder(clearedBatchSizes),
            limitedDialect,
        );
        const user = createOutboxUser(events(5));
        db.users.attach(user);
        connection.queueResult({ rowCount: 2 });
        connection.queueError(new Error('second chunk failed'));

        await expect(db.saveChanges()).rejects.toThrow('second chunk failed');

        expect(connection.statements).toHaveLength(2);
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(clearedBatchSizes).toEqual([]);
        expect(user.domainEvents).toHaveLength(5);
    });
});
