import { EntityNotTrackedError, EntityState, isEntityKitError } from '../packages/core/src';
import { RecordingDatabaseConnection } from '../packages/testing/src';
import { CreationContext, CreationUser } from './support/creation-context';

describe('explicit context tracking operations', () => {
    it('returns an entry only for an entity tracked by this context', async () => {
        const connection = new RecordingDatabaseConnection();
        await using db = CreationContext.create({ connection });
        await using other = CreationContext.create({ connection: new RecordingDatabaseConnection() });
        const user = db.users.create({ id: '1', name: 'Ada' });
        const entry = db.entryOrThrow(user);
        expect(entry).toBe(db.entry(user));
        expect(entry.state).toBe(EntityState.Added);
        expect(entry.collection(item => item.children).isLoaded).toBe(false);
        expect(() => other.entryOrThrow(user)).toThrow(EntityNotTrackedError);
        db.users.detach(user);
        expect(() => db.entryOrThrow(user)).toThrow(EntityNotTrackedError);
        expect(connection.statements).toEqual([]);
        expect(isEntityKitError(new EntityNotTrackedError())).toBe(true);
    });

    it.each(['clearTracking', 'clearChanges'] as const)('%s abandons work without reverting objects or writing SQL', async operation => {
        const connection = new RecordingDatabaseConnection();
        await using db = CreationContext.create({ connection });
        const user = new CreationUser({ id: '1', name: 'Ada' });
        db.users.attach(user);
        user.name = 'Different';
        const added = db.users.create({ id: '2', name: 'Grace' });
        db[operation]();
        expect(user.name).toBe('Different');
        expect(added.name).toBe('Grace');
        expect(db.changeTracker.entries()).toEqual([]);
        expect(db.getSavePlan()).toEqual([]);
        expect(() => db.entryOrThrow(user)).toThrow(EntityNotTrackedError);
        expect(await db.saveChanges()).toBe(0);
        expect(connection.statements).toEqual([]);
    });

    it('distinguishes an initialized collection from a loaded collection', async () => {
        await using db = CreationContext.create();
        await db.database.connection.query({
            text: 'create table creation_children (id text primary key, userId text not null)', values: [],
        });
        const user = new CreationUser({ id: '1', name: 'Ada' });
        db.users.attach(user);
        const collection = db.entryOrThrow(user).collection(item => item.children);
        expect(user.children).toEqual([]);
        expect(collection.isLoaded).toBe(false);
        expect(await collection.load()).toEqual([]);
        expect(collection.isLoaded).toBe(true);
    });
});
