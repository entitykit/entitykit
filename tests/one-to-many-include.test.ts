import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public email!: string;
    public posts!: Post[];

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class Post {
    public id!: string;
    public title!: string;
    public authorId!: string;
    public author!: User;

    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

class IncludeContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    public users = this.set(User);
    public posts = this.set(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(IncludeContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        });

        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.hasOne(User, post => post.author).withMany(user => user.posts).hasForeignKey(post => post.authorId);
        });
    }
}

function createDb(connection: RecordingDatabaseConnection): IncludeContext {
    IncludeContext.connection = connection;
    return IncludeContext.create();
}

describe('one-to-many includes', () => {
    it('loads collection navigations with a split query', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'a@example.com' },
                { id: 'usr_2', email: 'b@example.com' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'One', author_id: 'usr_1' },
                { id: 'post_2', title: 'Two', author_id: 'usr_1' },
            ],
            rowCount: 2,
        });
        const db =  createDb(connection);

        const users = await db.users
            .include(user => user.posts)
            .orderBy(user => user.id)
            .toArray();

        expect(connection.statements).toEqual([
            {
                text: 'select "id", "email" from "users" order by "id" asc',
                values: [],
            },
            {
                text: 'select "id", "title", "author_id" from "posts" where "author_id" in ($1, $2)',
                values: ['usr_1', 'usr_2'],
            },
        ]);
        expect(users[0]?.posts).toHaveLength(2);
        expect(users[0]?.posts[0]).toBeInstanceOf(Post);
        expect(users[0]?.posts[0]?.author).toBe(users[0]);
        expect(users[1]?.posts).toEqual([]);
        expect(db.entry(users[0])?.state).toBe(EntityState.Unchanged);
        expect(db.entry(users[0].posts[0])?.state).toBe(EntityState.Unchanged);
    });

    it('sets collection navigations to empty arrays when no dependents exist', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com' }], rowCount: 1 });
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  createDb(connection);

        const user = await db.users.include(item => item.posts).single();

        expect(user.posts).toEqual([]);
        expect(db.entry(user)?.loadedNavigations()).toEqual(['posts']);
        expect(connection.statements).toEqual([
            {
                text: 'select "id", "email" from "users" limit $1',
                values: [2],
            },
            {
                text: 'select "id", "title", "author_id" from "posts" where "author_id" in ($1)',
                values: ['usr_1'],
            },
        ]);
    });

    it('throws a clear error for unconfigured includes', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com' }], rowCount: 1 });
        const db =  createDb(connection);

        await expect(db.users.include(user => user.email).toArray())
            .rejects
            .toThrow('Include \'email\' is not configured as a relationship on entity \'User\'.');
    });
});
