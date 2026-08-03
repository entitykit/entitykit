import { ContextConcurrentOperationError, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    createSaveChangesDb,
    User,
} from './support/save-changes-fixture';

function user(): User {
    const now = new Date('2026-08-03T10:00:00.000Z');
    return new User({
        id: 'usr_1',
        email: 'a@example.com',
        name: 'before',
        createdAt: now,
        updatedAt: now,
    });
}

describe('transaction tracker invariants', () => {
    it('rejects re-adding a deleted object until its transaction completes', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createSaveChangesDb(connection);
        const entity = user();
        db.users.attach(entity);
        db.users.remove(entity);
        connection.queueResult({ rowCount: 1 });

        await expect(db.transaction(async transaction => {
            await transaction.saveChanges();
            expect(() => transaction.users.add(entity)).toThrow(
                ContextConcurrentOperationError,
            );
            throw new Error('abort transaction');
        })).rejects.toThrow('abort transaction');

        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(db.entry(entity)?.state).toBe(EntityState.Deleted);
        expect(db.getSavePlan()).toHaveLength(1);
    });

    it('rejects incompatible post-save state transitions and restores intent', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createSaveChangesDb(connection);
        const entity = user();
        db.users.attach(entity);
        entity.name = 'saved in transaction';
        connection.queueResult({ rowCount: 1 });

        await expect(db.transaction(async transaction => {
            await transaction.saveChanges();
            expect(() => transaction.users.remove(entity)).toThrow(
                ContextConcurrentOperationError,
            );
            entity.name = 'changed after save';
            throw new Error('abort transaction');
        })).rejects.toThrow('abort transaction');

        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(db.entry(entity)?.state).toBe(EntityState.Modified);
        expect(db.entry(entity)?.originalValues.name).toBe('before');
        expect(entity.name).toBe('changed after save');
    });
});
