import { EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    createSaveChangesDb as createDb,
    Post,
    User,
} from './support/save-changes-fixture';

describe('DbContext.saveChanges', () => {
    it('updates modified queried entities and inserts added entities in one transaction', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const updatedAt = new Date('2026-01-02T00:00:00.000Z');

        connection.queueResult({
            rows: [{ id: 'usr_1', email: 'ada@example.com', name: 'Ada', created_at: createdAt, updated_at: updatedAt }],
            rowCount: 1,
        });

        const user = await db.users.where(u => u.email.eq('ada@example.com')).single();
        user.name = 'Ada Lovelace';

        const post = new Post({
            id: 'post_1',
            title: 'Entity Framework but TypeScript',
            authorId: user.id,
            createdAt,
            updatedAt,
        });
        db.posts.add(post);

        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        expect(connection.statements.slice(1)).toEqual([
            {
                text: 'update "users" set "name" = $1 where "id" = $2',
                values: ['Ada Lovelace', 'usr_1'],
            },
            {
                text: 'insert into "posts" ("id", "title", "author_id", "created_at", "updated_at") values ($1, $2, $3, $4, $5)',
                values: ['post_1', 'Entity Framework but TypeScript', 'usr_1', createdAt, updatedAt],
            },
        ]);
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
        expect(db.entry(post)?.state).toBe(EntityState.Unchanged);
        expect(db.changeTracker.debugView()).toContain('User { id: "usr_1" } Unchanged');
    });

    it('returns zero and does not start a transaction when there are no changes', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);

        await expect(db.saveChanges()).resolves.toBe(0);

        expect(connection.transactionEvents).toEqual([]);
        expect(connection.statements).toEqual([]);
    });

    it('batches compatible added entities and returns the affected entity count', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');

        const user1 = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now });
        const user2 = new User({ id: 'usr_2', email: 'b@example.com', name: 'B', createdAt: now, updatedAt: now });
        db.users.add(user1);
        db.users.add(user2);
        connection.queueResult({ rowCount: 2 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(connection.statements).toEqual([
            {
                text: 'insert into "users" ("id", "email", "name", "created_at", "updated_at") values ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
                values: ['usr_1', 'a@example.com', 'A', now, now, 'usr_2', 'b@example.com', 'B', now, now],
            },
        ]);
        expect(db.entry(user1)?.state).toBe(EntityState.Unchanged);
        expect(db.entry(user2)?.state).toBe(EntityState.Unchanged);
    });

    it('throws when a batched insert affects fewer rows than expected', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');

        db.users.add(new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now }));
        db.users.add(new User({ id: 'usr_2', email: 'b@example.com', name: 'B', createdAt: now, updatedAt: now }));
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).rejects.toThrow('affected 1');
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
    });

    it('rolls back and leaves states unchanged when a command fails', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now });
        db.users.attach(user);
        user.name = 'B';

        connection.queueError(new Error('database failed'));

        await expect(db.saveChanges()).rejects.toThrow('database failed');

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(db.entry(user)?.state).toBe(EntityState.Modified);
        expect(db.entry(user)?.originalValues.name).toBe('A');
    });

    it('throws when an update or delete affects no rows', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now });
        db.users.attach(user);
        user.name = 'B';
        connection.queueResult({ rowCount: 0 });

        await expect(db.saveChanges()).rejects.toThrow('affected 0');
    });

    it('does not read audit providers when tracked entities do not use audit metadata', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection, {
            now: () => {
                throw new Error('audit timestamp should not be read');
            },
            currentUserId: () => {
                throw new Error('audit user should not be read');
            },
        });
        const now = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now });
        db.users.attach(user);
        user.name = 'B';
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);
    });

    it('rejects primary key mutation', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now });
        db.users.attach(user);
        user.id = 'usr_2';

        await expect(db.saveChanges()).rejects.toThrow('Primary key changes are not supported');
        expect(connection.transactionEvents).toEqual([]);
    });

    it('restores accepted tracker state when provider commit fails', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({
            id: 'usr_1', email: 'a@example.com', name: 'A',
            createdAt: now, updatedAt: now,
        });
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.failNextTransactionCommit(new Error('commit failed'));

        await expect(db.saveChanges()).rejects.toThrow('commit failed');

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
        expect(db.getSavePlan()).toHaveLength(1);
    });

    it('uses a savepoint when saveChanges is called inside db.transaction', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        db.users.add(new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now }));
        connection.queueResult({ rowCount: 1 });

        await db.transaction(async tx => {
            await tx.saveChanges();
        });

        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'commit',
        ]);
    });

    it('restores retryable tracked state when an explicit transaction rolls back', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now });
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });

        await expect(db.transaction(async tx => {
            await tx.saveChanges();
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'rollback',
        ]);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(db.getSavePlan()).toHaveLength(1);
    });

    it('rolls back nested explicit transactions to a savepoint after saveChanges', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now });
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });

        await db.transaction(async outer => {
            await expect(outer.transaction(async inner => {
                await inner.saveChanges();
                throw new Error('abort inner transaction');
            })).rejects.toThrow('abort inner transaction');
        });

        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'savepoint:entitykit_sp_2',
            'release:entitykit_sp_2',
            'rollback-to:entitykit_sp_1',
            'commit',
        ]);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(db.getSavePlan()).toHaveLength(1);
    });

    it('preserves outer tracked state when a nested savepoint rolls back', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const outerUser = new User({
            id: 'usr_1',
            email: 'a@example.com',
            name: 'Before outer',
            createdAt: now,
            updatedAt: now,
        });
        db.users.attach(outerUser);
        outerUser.name = 'Outer saved';
        connection.queueResult({ rowCount: 1 });

        await db.transaction(async outer => {
            await outer.saveChanges();
            const nestedUser = new User({
                id: 'usr_2',
                email: 'b@example.com',
                name: 'Nested',
                createdAt: now,
                updatedAt: now,
            });

            await expect(outer.transaction(async inner => {
                inner.users.add(nestedUser);
                connection.queueResult({ rowCount: 1 });
                await inner.saveChanges();
                throw new Error('abort inner transaction');
            })).rejects.toThrow('abort inner transaction');

            expect(outer.entry(outerUser)?.state).toBe(EntityState.Unchanged);
            expect(outer.entry(nestedUser)?.state).toBe(EntityState.Added);
            outer.users.detach(nestedUser);
            outerUser.name = 'Outer after inner';
            connection.queueResult({ rowCount: 1 });
            await expect(outer.saveChanges()).resolves.toBe(1);
        });

        expect(db.entry(outerUser)?.state).toBe(EntityState.Unchanged);
        expect(connection.statements.at(-1)?.values)
            .toContain('Outer after inner');
    });

    it('rolls back a failed saveChanges call to the explicit transaction savepoint', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const now = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt: now, updatedAt: now });
        db.users.add(user);
        connection.queueError(new Error('insert failed'));

        await db.transaction(async tx => {
            await expect(tx.saveChanges()).rejects.toThrow('insert failed');
        });

        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'rollback-to:entitykit_sp_1',
            'commit',
        ]);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
        expect(db.getSavePlan()).toHaveLength(1);
    });
});
