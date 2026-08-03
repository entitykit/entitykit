import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public createdAt!: Date;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class AppDbContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    public users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(AppDbContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('display_name').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
        });
    }
}

function createDb(connection = new RecordingDatabaseConnection()): AppDbContext {
    AppDbContext.connection = connection;
    return AppDbContext.create();
}

describe('DbSet query execution', () => {
    it('executes where/order/limit queries and materializes tracked class instances', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        connection.queueResult({
            rows: [{ id: 'usr_1', email: 'a@example.com', display_name: 'A', created_at: createdAt }],
            rowCount: 1,
        });

        const users = await db.users
            .where(user => user.email.like('%@example.com'))
            .orderByDescending(user => user.createdAt)
            .take(10)
            .toArray();

        expect(connection.statements).toEqual([{ text: 'select "id", "email", "display_name", "created_at" from "users" where "email" like $1 order by "created_at" desc limit $2', values: ['%@example.com', 10] }]);
        expect(users).toHaveLength(1);
        expect(users[0]).toBeInstanceOf(User);
        expect(users[0]).toMatchObject({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt });
        expect(db.entry(users[0])?.state).toBe(EntityState.Unchanged);
    });

    it('finds entities by configured primary key', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com', display_name: 'A', created_at: new Date() }], rowCount: 1 });

        const user = await db.users.find('usr_1');

        expect(user).toBeInstanceOf(User);
        expect(connection.statements[0]).toEqual({
            text: 'select "id", "email", "display_name", "created_at" from "users" where "id" = $1 limit $2',
            values: ['usr_1', 1],
        });
    });

    it('reuses identity-map instances across repeated queries', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com', display_name: 'A', created_at: new Date() }], rowCount: 1 });
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'changed@example.com', display_name: 'Changed', created_at: new Date() }], rowCount: 1 });

        const first = await db.users.find('usr_1');
        requireDefined(first).name = 'Local';
        const second = await db.users.find('usr_1');

        expect(second).toBe(first);
        expect(requireDefined(second).name).toBe('Local');
        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(connection.statements).toHaveLength(1);
    });

    it('does not return a tracked entity pending deletion', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        const user = new User({
            id: 'usr_1',
            email: 'a@example.com',
            name: 'A',
            createdAt: new Date(),
        });
        db.users.attach(user);
        db.users.remove(user);

        await expect(db.users.find('usr_1')).resolves.toBeNull();
        expect(connection.statements).toEqual([]);
    });

    it('returns duplicate root rows as the same tracked instance without overwriting first values', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const firstCreatedAt = new Date('2026-01-01T00:00:00.000Z');
        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'first@example.com', display_name: 'First', created_at: firstCreatedAt },
                { id: 'usr_1', email: 'second@example.com', display_name: 'Second', created_at: new Date('2026-01-02T00:00:00.000Z') },
            ],
            rowCount: 2,
        });

        const users = await db.users.toArray();

        expect(users).toHaveLength(2);
        expect(users[1]).toBe(users[0]);
        expect(users[0]).toMatchObject({
            email: 'first@example.com',
            name: 'First',
            createdAt: firstCreatedAt,
        });
        expect(db.changeTracker.entries()).toHaveLength(1);
    });

    it('compiles empty in filters to the provider false predicate', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [], rowCount: 0 });

        const users = await db.users.where(user => user.id.in([])).toArray();

        expect(users).toEqual([]);
        expect(connection.statements).toEqual([{
            text: 'select "id", "email", "display_name", "created_at" from "users" where 1 = 0',
            values: [],
        }]);
    });

    it('preserves mixed ordering with pagination', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [], rowCount: 0 });

        await db.users
            .orderBy(user => user.email)
            .orderByDescending(user => user.createdAt)
            .skip(5)
            .take(10)
            .toArray();

        expect(connection.statements).toEqual([{
            text: 'select "id", "email", "display_name", "created_at" from "users" order by "email" asc, "created_at" desc limit $1 offset $2',
            values: [10, 5],
        }]);
    });

    it('supports first and single terminal semantics', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);

        connection.queueResult({ rows: [], rowCount: 0 });
        await expect(db.users.firstOrNull()).resolves.toBeNull();

        connection.queueResult({ rows: [], rowCount: 0 });
        await expect(db.users.single()).rejects.toThrow('No \'User\' entity matched');

        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'a@example.com', display_name: 'A', created_at: new Date() },
                { id: 'usr_2', email: 'b@example.com', display_name: 'B', created_at: new Date() },
            ],
            rowCount: 2,
        });
        await expect(db.users.single()).rejects.toThrow('More than one \'User\' entity matched');
    });

    it('supports count exists and explicit transactions', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [{ count: 2 }], rowCount: 1 });
        connection.queueResult({ rows: [{ exists: true }], rowCount: 1 });

        await expect(db.users.where(user => user.email.like('%@example.com')).count()).resolves.toBe(2);
        await expect(db.users.where(user => user.email.eq('a@example.com')).exists()).resolves.toBe(true);

        await db.transaction(async tx => {
            await tx.users.count();
        });

        expect(connection.statements[0]).toEqual({
            text: 'select count(*)::int as "count" from "users" where "email" like $1',
            values: ['%@example.com'],
        });
        expect(connection.statements[1]).toEqual({
            text: 'select exists(select 1 from "users" where "email" = $1 limit 1) as "exists"',
            values: ['a@example.com'],
        });
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('treats empty aggregate result sets as zero and false', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [], rowCount: 0 });
        connection.queueResult({ rows: [], rowCount: 0 });

        await expect(db.users.count()).resolves.toBe(0);
        await expect(db.users.exists()).resolves.toBe(false);

        expect(connection.statements).toEqual([
            {
                text: 'select count(*)::int as "count" from "users"',
                values: [],
            },
            {
                text: 'select exists(select 1 from "users" limit 1) as "exists"',
                values: [],
            },
        ]);
    });
});
