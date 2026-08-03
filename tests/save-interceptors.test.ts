import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState, type SaveChangesInterceptor } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public name!: string;
    public deletedAt!: Date | null;
    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class TestContext extends DbContext {
    public users = this.set(User);

    public static createWith(
        connection: RecordingDatabaseConnection,
        interceptor: SaveChangesInterceptor,
    ): TestContext {
        return TestContext.create(connection, interceptor);
    }

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly interceptor: SaveChangesInterceptor,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection).useSaveInterceptor(this.interceptor);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.softDelete(user => user.deletedAt);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(user => user.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
        });
    }
}

describe('save changes interceptors', () => {
    it('runs before and after save hooks with the generated save plan', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const events: string[] = [];
        const interceptor: SaveChangesInterceptor = {
            savingChanges: event => {
                events.push(`saving:${String(event.plan.length)}:${event.plan[0]?.state}`);
            },
            savedChanges: event => {
                events.push(`saved:${String(event.affectedEntities)}:${event.plan[0]?.entityName}`);
            },
        };
        const db =  TestContext.createWith(connection, interceptor);

        db.users.add(new User({ id: 'usr_1', name: 'Ada' }));
        await db.saveChanges();

        expect(events).toEqual([`saving:1:${EntityState.Added}`, 'saved:1:User']);
    });

    it('rebuilds the executable plan after a before-save hook mutates an entity', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const user = new User({ id: 'usr_1', name: 'before hook' });
        const db = TestContext.createWith(connection, {
            savingChanges: () => {
                user.name = 'after hook';
            },
        });
        db.users.add(user);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements).toEqual([{
            text: 'insert into "users" ("id", "deleted_at", "name") values ($1, $2, $3)',
            values: ['usr_1', undefined, 'after hook'],
        }]);
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
    });

    it('includes entities added by a before-save hook in the executable plan', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 2 });
        const first = new User({ id: 'usr_1', name: 'First' });
        const late = new User({ id: 'usr_2', name: 'Late' });
        const db = TestContext.createWith(connection, {
            savingChanges: () => {
                db.users.add(late);
            },
        });
        db.users.add(first);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(connection.statements[0]).toEqual({
            text: 'insert into "users" ("id", "deleted_at", "name") values ($1, $2, $3), ($4, $5, $6)',
            values: ['usr_1', undefined, 'First', 'usr_2', undefined, 'Late'],
        });
        expect(db.entry(first)?.state).toBe(EntityState.Unchanged);
        expect(db.entry(late)?.state).toBe(EntityState.Unchanged);
    });

    it('runs failure hooks without accepting changes', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueError(new Error('boom'));
        const events: string[] = [];
        const interceptor: SaveChangesInterceptor = {
            saveChangesFailed: event => {
                events.push(`failed:${String(event.plan.length)}:${(event.error as Error).message}`);
            },
        };
        const db =  TestContext.createWith(connection, interceptor);
        const user = new User({ id: 'usr_1', name: 'Ada' });
        db.users.add(user);

        await expect(db.saveChanges()).rejects.toThrow('boom');

        expect(events).toEqual(['failed:1:boom']);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
    });

    it('does not start a transaction when the before-save hook fails', async () => {
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('before save failed');
        const events: string[] = [];
        const interceptor: SaveChangesInterceptor = {
            savingChanges: event => {
                events.push(`saving:${String(event.plan.length)}`);
                throw failure;
            },
            saveChangesFailed: () => {
                events.push('failed');
            },
        };
        const db =  TestContext.createWith(connection, interceptor);
        const user = new User({ id: 'usr_1', name: 'Ada' });
        db.users.add(user);

        await expect(db.saveChanges()).rejects.toBe(failure);

        expect(events).toEqual(['saving:1']);
        expect(connection.transactionEvents).toEqual([]);
        expect(connection.statements).toEqual([]);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
    });

    it('restores a soft delete when the before-save hook fails, then retries', async () => {
        const connection = new RecordingDatabaseConnection();
        let rejectSave = true;
        const interceptor: SaveChangesInterceptor = {
            savingChanges: () => {
                if (rejectSave) {
                    throw new Error('before save failed');
                }
            },
        };
        const db =  TestContext.createWith(connection, interceptor);
        const user = new User({ id: 'usr_1', name: 'Ada', deletedAt: null });
        db.users.attach(user);
        db.users.remove(user);

        await expect(db.saveChanges()).rejects.toThrow('before save failed');

        expect(connection.statements).toEqual([]);
        expect(user.deletedAt).toBeNull();
        expect(db.entry(user)?.state).toBe(EntityState.Deleted);

        rejectSave = false;
        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(user.deletedAt).toBeInstanceOf(Date);
    });

    it('does not report a committed save as failed when an after-save hook throws', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const failure = new Error('after save failed');
        const events: string[] = [];
        const interceptor: SaveChangesInterceptor = {
            savedChanges: event => {
                events.push(`saved:${String(event.affectedEntities)}`);
                throw failure;
            },
            saveChangesFailed: event => {
                events.push(`failed:${(event.error as Error).message}`);
            },
        };
        const db =  TestContext.createWith(connection, interceptor);
        const user = new User({ id: 'usr_1', name: 'Ada' });
        db.users.add(user);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(events).toEqual(['saved:1']);
        // A one-row plan runs without a transaction: a single statement is
        // already atomic, and the begin/commit pair was two round trips for
        // nothing. Multi-statement and multi-row plans still take one — see
        // tests/single-statement-saves.test.ts.
        expect(connection.transactionEvents).toEqual([]);
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
    });

    it('does not reject an explicit transaction after a deferred after-save hook throws', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = TestContext.createWith(connection, {
            savedChanges: () => {
                throw new Error('after save failed');
            },
        });

        await expect(db.transaction(async transaction => {
            transaction.users.add(new User({ id: 'usr_1', name: 'Ada' }));
            await transaction.saveChanges();
        })).resolves.toBeUndefined();

        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'commit',
        ]);
    });

    it('preserves the provider error when a failure hook also throws', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueError(new Error('provider failed'));
        const failure = new Error('failure hook failed');
        const events: string[] = [];
        const interceptor: SaveChangesInterceptor = {
            saveChangesFailed: event => {
                events.push(`failed:${(event.error as Error).message}`);
                throw failure;
            },
        };
        const db =  TestContext.createWith(connection, interceptor);
        const user = new User({ id: 'usr_1', name: 'Ada' });
        db.users.add(user);

        await expect(db.saveChanges()).rejects.toThrow('provider failed');

        expect(events).toEqual(['failed:provider failed']);
        // A one-row plan runs without a transaction: a single statement is
        // already atomic, and the begin/commit pair was two round trips for
        // nothing. Multi-statement and multi-row plans still take one — see
        // tests/single-statement-saves.test.ts.
        expect(connection.transactionEvents).toEqual([]);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
    });
});
