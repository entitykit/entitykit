import {
    DatabaseProviderError,
    EntityState,
    TransactionOutcomeUnknownError,
} from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    createSaveChangesDb,
    User,
} from './support/save-changes-fixture';

class UnknownCommitConnection extends RecordingDatabaseConnection {
    public readonly failure = new TransactionOutcomeUnknownError(
        'postgres',
        new DatabaseProviderError(
            'Postgres commit failed.',
            undefined,
            {
                provider: 'postgres',
                operation: 'commit',
                code: 'ECONNRESET',
            },
        ),
    );

    public override async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
    ): Promise<TResult> {
        this.transactionEvents.push('begin');
        await work();
        this.transactionEvents.push('commit');
        throw this.failure;
    }
}

describe('unknown commit outcomes', () => {
    it('makes the context unusable after restoring accepted tracker state', async () => {
        const connection = new UnknownCommitConnection();
        const db = createSaveChangesDb(connection);
        const now = new Date('2026-08-03T10:00:00.000Z');
        const user = new User({
            id: 'usr_1',
            email: 'a@example.com',
            name: 'User',
            createdAt: now,
            updatedAt: now,
        });
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).rejects.toBe(connection.failure);

        expect(db.entry(user)?.state).toBe(EntityState.Added);
        await expect(db.users.find(user.id)).rejects.toBe(connection.failure);
        await expect(db.saveChanges()).rejects.toBe(connection.failure);
        expect(connection.statements).toHaveLength(1);
    });
});
