import { DbUpdateConcurrencyError, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    createConcurrencyContext,
    createConcurrencyUser,
} from './support/optimistic-concurrency-fixture';

describe('optimistic concurrency saves', () => {
    it('increments numeric version values after a successful save', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db =  createConcurrencyContext(connection);
        const user = createConcurrencyUser();
        db.users.attach(user);
        user.name = 'B';

        await db.saveChanges();

        expect(user.version).toBe(2);
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
        expect(db.entry(user)?.originalValues.version).toBe(2);
    });

    it('keeps concurrency-token updates on the per-entity save path', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db =  createConcurrencyContext(connection);
        const updatedAt = new Date('2026-01-01T00:00:00.000Z');
        const first = createConcurrencyUser({ updatedAt });
        const second = createConcurrencyUser({
            id: 'usr_2',
            email: 'b@example.com',
            name: 'B',
            version: 4,
            updatedAt,
        });
        db.users.attach(first);
        db.users.attach(second);
        first.name = 'A2';
        second.name = 'B2';

        await db.saveChanges();

        expect(connection.statements).toEqual([
            {
                text: 'update "users" set "name" = $1, "version" = "version" + 1 where "id" = $2 and "version" = $3 and "updated_at" = $4',
                values: ['A2', 'usr_1', 1, updatedAt],
            },
            {
                text: 'update "users" set "name" = $1, "version" = "version" + 1 where "id" = $2 and "version" = $3 and "updated_at" = $4',
                values: ['B2', 'usr_2', 4, updatedAt],
            },
        ]);
    });

    it('keeps concurrency-token deletes on the per-entity save path', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db =  createConcurrencyContext(connection);
        const updatedAt = new Date('2026-01-01T00:00:00.000Z');
        const first = createConcurrencyUser({ updatedAt });
        const second = createConcurrencyUser({
            id: 'usr_2',
            email: 'b@example.com',
            name: 'B',
            version: 4,
            updatedAt,
        });
        db.users.attach(first);
        db.users.attach(second);
        db.users.remove(first);
        db.users.remove(second);

        await db.saveChanges();

        expect(connection.statements).toEqual([
            {
                text: 'delete from "users" where "id" = $1 and "version" = $2 and "updated_at" = $3',
                values: ['usr_1', 1, updatedAt],
            },
            {
                text: 'delete from "users" where "id" = $1 and "version" = $2 and "updated_at" = $3',
                values: ['usr_2', 4, updatedAt],
            },
        ]);
    });

    it('throws a typed concurrency error when an update affects no rows', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 0 });
        const db =  createConcurrencyContext(connection);
        const user = createConcurrencyUser();
        db.users.attach(user);
        user.name = 'B';

        await expect(db.saveChanges()).rejects.toBeInstanceOf(DbUpdateConcurrencyError);
        expect(db.entry(user)?.state).toBe(EntityState.Modified);
    });

    it('throws a typed concurrency error when a provider reports too many update rows', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 2 });
        const db =  createConcurrencyContext(connection);
        const user = createConcurrencyUser();
        db.users.attach(user);
        user.name = 'B';

        let thrown: unknown;
        try {
            await db.saveChanges();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toMatchObject({
            entityName: 'User',
            keyValue: 'usr_1',
            state: EntityState.Modified,
            rowCount: 2,
        });
        expect(db.entry(user)?.state).toBe(EntityState.Modified);
        expect(user.version).toBe(1);
    });
});
