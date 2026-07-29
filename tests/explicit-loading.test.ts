import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
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

class LoadingContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    public users = this.set(User);
    public posts = this.set(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(LoadingContext.connection);
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

function createDb(connection: RecordingDatabaseConnection): LoadingContext {
    LoadingContext.connection = connection;
    return LoadingContext.create();
}

describe('explicit loading', () => {
    it('loads reference navigations from db.entry(entity)', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com' }], rowCount: 1 });
        const db =  createDb(connection);
        const post = new Post({ id: 'post_1', title: 'One', authorId: 'usr_1' });
        db.posts.attach(post);

        const reference = requireDefined(db.entry(post)).reference(item => item.author);
        expect(reference.isLoaded).toBe(false);

        const author = await reference.load();

        expect(connection.statements).toEqual([
            { text: 'select "id", "email" from "users" where "id" in ($1)', values: ['usr_1'] },
        ]);
        expect(author).toBeInstanceOf(User);
        expect(post.author).toBe(author);
        expect(reference.isLoaded).toBe(true);
        expect(requireDefined(db.entry(post)).loadedNavigations()).toEqual(['author']);
    });

    it('sets explicit reference loads with null foreign keys to null without querying', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const post = new Post({ id: 'post_1', title: 'One', authorId: null });
        db.posts.attach(post);

        const reference = requireDefined(db.entry(post)).reference(item => item.author);
        const author = await reference.load();

        expect(author).toBeNull();
        expect(post.author).toBeNull();
        expect(reference.isLoaded).toBe(true);
        expect(connection.statements).toEqual([]);
    });

    it('sets explicit reference loads with missing principals to null', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  createDb(connection);
        const post = new Post({ id: 'post_1', title: 'One', authorId: 'missing' });
        db.posts.attach(post);

        const author = await requireDefined(db.entry(post)).reference(item => item.author).load();

        expect(author).toBeNull();
        expect(post.author).toBeNull();
        expect(requireDefined(db.entry(post)).loadedNavigations()).toEqual(['author']);
        expect(connection.statements).toEqual([
            { text: 'select "id", "email" from "users" where "id" in ($1)', values: ['missing'] },
        ]);
    });

    it('loads collection navigations from db.entry(entity)', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'One', author_id: 'usr_1' },
                { id: 'post_2', title: 'Two', author_id: 'usr_1' },
            ],
            rowCount: 2,
        });
        const db =  createDb(connection);
        const user = new User({ id: 'usr_1', email: 'a@example.com' });
        db.users.attach(user);

        const collection = requireDefined(db.entry(user)).collection(item => item.posts);
        expect(collection.isLoaded).toBe(false);

        const posts = await collection.load();

        expect(connection.statements).toEqual([
            { text: 'select "id", "title", "author_id" from "posts" where "author_id" in ($1)', values: ['usr_1'] },
        ]);
        expect(posts.map(post => post.id)).toEqual(['post_1', 'post_2']);
        expect(user.posts).toBe(posts);
        expect(collection.isLoaded).toBe(true);
        expect(requireDefined(db.entry(user)).loadedNavigations()).toEqual(['posts']);
    });

    it('sets explicit collection loads with no dependents to empty arrays', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  createDb(connection);
        const user = new User({ id: 'usr_1', email: 'a@example.com' });
        db.users.attach(user);

        const collection = requireDefined(db.entry(user)).collection(item => item.posts);
        const posts = await collection.load();

        expect(posts).toEqual([]);
        expect(user.posts).toEqual([]);
        expect(collection.isLoaded).toBe(true);
        expect(connection.statements).toEqual([
            { text: 'select "id", "title", "author_id" from "posts" where "author_id" in ($1)', values: ['usr_1'] },
        ]);
    });
});
