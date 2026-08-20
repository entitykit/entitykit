import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { RecordingDatabaseConnection } from '../packages/testing/src';

class OrderUser {
    public id!: string;
    public email!: string;
    public posts!: OrderPost[];
}

class OrderPost {
    public id!: string;
    public authorId!: string;
    public title!: string;
    public author!: OrderUser;
}

let connection: RecordingDatabaseConnection;

abstract class OrderModelContext extends DbContext {
    public users = this.set(OrderUser);
    public posts = this.set(OrderPost);

    protected override model(model: ModelBuilder): void {
        model.entity(OrderUser, entity => {
            entity.toTable('order_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired().isUnique();
        });

        model.entity(OrderPost, entity => {
            entity.toTable('order_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.hasOne(OrderUser, post => post.author)
                .withMany(user => user.posts)
                .hasForeignKey(post => post.authorId);
        });
    }
}

class OrderContext extends OrderModelContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(connection);
    }
}

class SqliteOrderContext extends OrderModelContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
}

async function openSqlite(): Promise<SqliteOrderContext> {
    const db = SqliteOrderContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    await db.database.connection.query({ text: 'pragma foreign_keys = on', values: [] });
    return db;
}

describe('saveChanges graph ordering', () => {
    beforeEach(() => {
        connection = new RecordingDatabaseConnection();
    });

    it('inserts principals before dependents', async () => {
        const db =  OrderContext.create();
        db.posts.add({ id: 'post_1', authorId: 'usr_1', title: 'Post' } as OrderPost);
        db.users.add({ id: 'usr_1', email: 'a@example.com' } as OrderUser);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await db.saveChanges();

        expect(connection.statements[0]?.text).toContain('insert into "order_users"');
        expect(connection.statements[1]?.text).toContain('insert into "order_posts"');
    });

    it('deletes dependents before principals', async () => {
        const db =  OrderContext.create();
        const user = { id: 'usr_1', email: 'a@example.com' } as OrderUser;
        const post = { id: 'post_1', authorId: 'usr_1', title: 'Post' } as OrderPost;
        db.users.attach(user);
        db.posts.attach(post);
        db.users.remove(user);
        db.posts.remove(post);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await db.saveChanges();

        expect(connection.statements[0]?.text).toContain('delete from "order_posts"');
        expect(connection.statements[1]?.text).toContain('delete from "order_users"');
    });

    it('inserts a new principal before updating a dependent to reference it', async () => {
        const db =  OrderContext.create();
        const oldUser = {
            id: 'usr_old',
            email: 'old@example.com',
        } as OrderUser;
        const post = {
            id: 'post_1',
            authorId: oldUser.id,
            title: 'Post',
        } as OrderPost;
        db.users.attach(oldUser);
        db.posts.attach(post);
        post.authorId = 'usr_new';
        db.users.add({ id: 'usr_new', email: 'new@example.com' } as OrderUser);
        db.users.remove(oldUser);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await db.saveChanges();

        expect(connection.statements[0]?.text).toContain('insert into "order_users"');
        expect(connection.statements[1]?.text).toContain('update "order_posts"');
        expect(connection.statements[2]?.text).toContain('delete from "order_users"');
    });

    it('reparents to a new principal with SQLite foreign keys enabled', async () => {
        const db = await openSqlite();
        const oldUser = { id: 'usr_old', email: 'old@example.com' } as OrderUser;
        const post = {
            id: 'post_1',
            authorId: oldUser.id,
            title: 'Post',
        } as OrderPost;
        db.users.add(oldUser);
        db.posts.add(post);
        await db.saveChanges();

        const newUser = { id: 'usr_new', email: 'new@example.com' } as OrderUser;
        db.users.add(newUser);
        post.authorId = newUser.id;
        db.users.remove(oldUser);
        await expect(db.saveChanges()).resolves.toBe(3);

        db.changeTracker.clear();
        await expect(db.posts.find('post_1')).resolves.toMatchObject({
            authorId: 'usr_new',
        });
        await expect(db.users.find('usr_old')).resolves.toBeNull();
        await db.dispose();
    });

    it('updates an unrelated unique value before an insert claims it', async () => {
        const db = await openSqlite();
        const existing = { id: 'usr_1', email: 'claimed@example.com' } as OrderUser;
        db.users.add(existing);
        await db.saveChanges();

        existing.email = 'released@example.com';
        db.users.add({ id: 'usr_2', email: 'claimed@example.com' } as OrderUser);
        await expect(db.saveChanges()).resolves.toBe(2);

        db.changeTracker.clear();
        await expect(db.users.count()).resolves.toBe(2);
        await db.dispose();
    });
});
