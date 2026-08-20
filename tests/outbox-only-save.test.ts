import { RecordingDatabaseConnection } from '../packages/testing/src';
import {
    createOutboxUser,
    OutboxContext,
} from './support/outbox-fixture';

describe('outbox-only saves', () => {
    it('writes events raised by an unchanged tracked aggregate', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = OutboxContext.createWith(connection);
        const user = createOutboxUser([]);
        db.users.attach(user);
        user.domainEvents.push({
            type: 'PasswordResetRequested',
            payload: { userId: user.id },
        });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(0);

        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]?.text).toContain('insert into "app_outbox"');
        expect(user.domainEvents).toEqual([]);
    });
});
