import { RecordingDatabaseConnection } from '../src/testing';
import {
    createOutboxUser,
    OutboxContext,
} from './support/outbox-fixture';

describe('outbox event clearing', () => {
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
});
