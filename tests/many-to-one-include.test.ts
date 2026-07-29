import { requireDefined } from './support/require-defined';
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
    public authorId!: string | null;
    public author!: User | null;

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

describe('many-to-one includes', () => {
    it('loads principal entities with a split query and assigns navigation properties', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'One', author_id: 'usr_1' },
                { id: 'post_2', title: 'Two', author_id: 'usr_1' },
                { id: 'post_3', title: 'Three', author_id: 'usr_2' },
            ],
            rowCount: 3,
        });
        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'a@example.com' },
                { id: 'usr_2', email: 'b@example.com' },
            ],
            rowCount: 2,
        });
        const db =  createDb(connection);

        const posts = await db.posts
            .include(post => post.author)
            .orderBy(post => post.id)
            .toArray();

        expect(connection.statements).toEqual([
            {
                text: 'select "id", "title", "author_id" from "posts" order by "id" asc',
                values: [],
            },
            {
                text: 'select "id", "email" from "users" where "id" in ($1, $2)',
                values: ['usr_1', 'usr_2'],
            },
        ]);
        expect(posts[0]?.author).toBeInstanceOf(User);
        expect(posts[0]?.author?.email).toBe('a@example.com');
        expect(posts[1]?.author).toBe(posts[0]?.author);
        expect(posts[2]?.author?.email).toBe('b@example.com');
        expect(db.entry(posts[0])?.state).toBe(EntityState.Unchanged);
        expect(db.entry(requireDefined(posts[0].author))?.state).toBe(EntityState.Unchanged);
    });

    it('sets missing principal navigations to null', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'post_1', title: 'One', author_id: 'missing' }], rowCount: 1 });
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  createDb(connection);

        const post = await db.posts.include(item => item.author).single();

        expect(post.author).toBeNull();
    });

    it('sets null foreign-key reference navigations to null without querying principals', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'post_1', title: 'One', author_id: null }], rowCount: 1 });
        const db =  createDb(connection);

        const post = await db.posts.include(item => item.author).single();

        expect(post.author).toBeNull();
        expect(db.entry(post)?.loadedNavigations()).toEqual(['author']);
        expect(connection.statements).toEqual([
            {
                text: 'select "id", "title", "author_id" from "posts" limit $1',
                values: [2],
            },
        ]);
    });
});
