import { requireDefined } from './support/require-defined';
import type {
    ModelBuilder } from '../packages/core/src';
import {
    DbContext,
    DeleteBehavior,
    lazy,
    type DatabaseConnection,
    type DatabaseQueryResult,
    type RuntimeDiagnosticEvent,
    type SqlStatement,
} from '../packages/core/src';
import { DbContextOptionsBuilder } from '../packages/core/src/core/context-options/db-context-options-builder';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../packages/sqlite/src';

/**
 * Awaitable lazy loading. EF loads during property access because a C# getter
 * can block on I/O; TypeScript cannot, so the `await` lives in the caller's
 * code instead. See the relationship-loading section in USAGE.md.
 */
class Author {
    public id!: string;
    public name!: string;
    public posts?: Post[];

    constructor(data?: Partial<Author>) {
        Object.assign(this, data);
    }
}

class Post {
    public id!: string;
    public authorId!: string;
    public title!: string;
    public author?: Author;

    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

class CountingConnection implements DatabaseConnection {
    private readonly inner = new SqliteDatabaseConnection(databaseFile);
    public readonly statements: string[] = [];

    public get isInTransaction(): boolean {
        return this.inner.isInTransaction;
    }

    public async query<TRow extends Record<string, unknown> = Record<string, unknown>>(statement: SqlStatement): Promise<DatabaseQueryResult<TRow>> {
        this.statements.push(statement.text);
        return this.inner.query<TRow>(statement);
    }

    public async transaction<TResult>(work: () => TResult | Promise<TResult>): Promise<TResult> {
        return this.inner.transaction(work);
    }

    public async session<TResult>(work: () => TResult | Promise<TResult>): Promise<TResult> {
        return this.inner.session(work);
    }

    public async dispose(): Promise<void> {
        return this.inner.dispose();
    }
}

const databaseFile = ':memory:';
let lazyOptions: { enabled: boolean; maxPerContext?: number } = { enabled: true };

class BlogDbContext extends DbContext {
    public authors = this.set(Author);
    public posts = this.set(Post);
    public readonly connection = new CountingConnection();
    public readonly lazyEvents: Array<Extract<RuntimeDiagnosticEvent, { kind: 'lazyLoad' }>> = [];

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(
            this.connection,
            {
                provider: 'sqlite',
                dialect: sqliteProviderServices.dialect,
                migrationDialect: sqliteProviderServices.migrationDialect,
                createMigrationBuilder:
                    sqliteProviderServices.createMigrationBuilder,
            },
        );
        if (lazyOptions.enabled) {
            options.useLazyLoading(lazyOptions.maxPerContext === undefined ? {} : { maxPerContext: lazyOptions.maxPerContext });
        }
        options.useDiagnostics(event => {
            if (event.kind === 'lazyLoad') {
                this.lazyEvents.push(event);
            }
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Author, entity => {
            entity.toTable('authors');
            entity.hasKey(author => author.id);
            entity.property(author => author.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(author => author.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.hasOne(Author, post => post.author).withMany(author => author.posts)
                .hasForeignKey(post => post.authorId).onDelete(DeleteBehavior.Cascade);
        });
    }
}

async function open(): Promise<BlogDbContext> {
    const db =  BlogDbContext.create();
    await db.database.connection.query({ text: 'create table authors (id text primary key, name text not null)', values: [] });
    await db.database.connection.query({ text: 'create table posts (id text primary key, author_id text not null, title text not null)', values: [] });

    db.authors.add(new Author({ id: 'a1', name: 'Ada' }));
    db.posts.add(new Post({ id: 'p1', authorId: 'a1', title: 'First' }));
    db.posts.add(new Post({ id: 'p2', authorId: 'a1', title: 'Second' }));
    await db.saveChanges();
    db.changeTracker.clear();
    db.connection.statements.length = 0;
    db.lazyEvents.length = 0;
    return db;
}

beforeEach(() => {
    lazyOptions = { enabled: true };
});

describe('lazy loading', () => {
    it('loads a reference navigation on await', async () => {
        const db = await open();
        const post = await db.posts.find('p1');

        const author = await lazy(requireDefined(post)).author;

        expect(author).toBeInstanceOf(Author);
        expect(author.name).toBe('Ada');
        await db.dispose();
    });

    it('loads a collection navigation declared on the other side', async () => {
    // `Author.posts` is the inverse of the relationship configured on `Post`,
    // so it is not on Author's own metadata.
        const db = await open();
        const author = await db.authors.find('a1');

        const posts = await lazy(requireDefined(author)).posts;

        expect(posts.map(post => post.id).sort()).toEqual(['p1', 'p2']);
        await db.dispose();
    });

    it('assigns the value onto the entity, like include does', async () => {
        const db = await open();
        const post = await db.posts.find('p1');

        await lazy(requireDefined(post)).author;

        expect(requireDefined(post).author?.name).toBe('Ada');
        await db.dispose();
    });

    it('does not query again once loaded', async () => {
        const db = await open();
        const post = await db.posts.find('p1');
        const afterFind = db.connection.statements.length;

        await lazy(requireDefined(post)).author;
        const afterFirst = db.connection.statements.length;
        await lazy(requireDefined(post)).author;

        expect(afterFirst).toBe(afterFind + 1);
        expect(db.connection.statements).toHaveLength(afterFirst);
        await db.dispose();
    });

    it('issues nothing when include already loaded the navigation', async () => {
        const db = await open();
        const [post] = await db.posts.include(entity => entity.author).where(entity => entity.id.eq('p1')).toArray();
        db.connection.statements.length = 0;

        const author = await lazy(post).author;

        expect(author.name).toBe('Ada');
        expect(db.connection.statements).toHaveLength(0);
        expect(db.lazyEvents.at(-1)).toMatchObject({ queried: false });
        await db.dispose();
    });

    it('shares one query between concurrent awaits of the same navigation', async () => {
        const db = await open();
        const post = await db.posts.find('p1');
        db.connection.statements.length = 0;

        const [first, second] = await Promise.all([lazy(requireDefined(post)).author, lazy(requireDefined(post)).author]);

        expect(first).toBe(second);
        expect(db.connection.statements).toHaveLength(1);
        await db.dispose();
    });

    it('reports every load to diagnostics', async () => {
        const db = await open();
        const post = await db.posts.find('p1');

        await lazy(requireDefined(post)).author;

        expect(db.lazyEvents).toHaveLength(1);
        expect(db.lazyEvents[0]).toMatchObject({
            kind: 'lazyLoad',
            entityName: 'Post',
            navigationProperty: 'author',
            queried: true,
            contextLoadCount: 1,
        });
        await db.dispose();
    });

    describe('cannot be triggered by accident', () => {
        it('stays invisible to serialization, spreading, and key enumeration', async () => {
            // The stated risk: "serialization or logging can accidentally trigger
            // database work". The loader is symbol-keyed and non-enumerable, so none
            // of these can reach it.
            const db = await open();
            const post = await db.posts.find('p1');
            db.connection.statements.length = 0;

            expect(JSON.parse(JSON.stringify(post))).toEqual({ id: 'p1', authorId: 'a1', title: 'First' });
            expect(Object.assign({}, requireDefined(post))).toEqual({ id: 'p1', authorId: 'a1', title: 'First', author: undefined });
            // `author` is an own property because `author?: Author` is a class field
            // and the build targets ES2022, which defines it as undefined. That is
            // the class declaration's doing, not the loader's.
            expect(Object.keys(requireDefined(post))).toEqual(['id', 'authorId', 'title', 'author']);
            // The loader is an own property, but symbol-keyed and non-enumerable, so
            // nothing that walks string keys can reach it.
            const [loaderSymbol] = Object.getOwnPropertySymbols(requireDefined(post));
            expect(String(loaderSymbol)).toBe('Symbol(entitykit.lazyLoader)');
            expect(Object.getOwnPropertyDescriptor(requireDefined(post), loaderSymbol)?.enumerable).toBe(false);

            expect(db.connection.statements).toHaveLength(0);
            expect(db.lazyEvents).toHaveLength(0);
            await db.dispose();
        });

        it('leaves entities as plain instances, not proxies', async () => {
            const db = await open();
            const post = await db.posts.find('p1');

            expect(post).toBeInstanceOf(Post);
            expect(Object.getPrototypeOf(post)).toBe(Post.prototype);
            await db.dispose();
        });
    });

    describe('refuses clearly', () => {
        it('when lazy loading is not enabled', async () => {
            lazyOptions = { enabled: false };
            const db = await open();
            const post = await db.posts.find('p1');

            expect(() => lazy(requireDefined(post))).toThrow(/options\.useLazyLoading\(\)/);
            await db.dispose();
        });

        it('when the name is not a navigation, listing the ones that are', async () => {
            const db = await open();
            const post = await db.posts.find('p1');

            expect(() => (lazy(requireDefined(post)) as unknown as Record<string, unknown>).nope)
                .toThrow(/'nope' is not a navigation property on 'Post'.*'author'/s);
            await db.dispose();
        });

        it('when the entity is not tracked', async () => {
            const db = await open();
            const post = await db.posts.find('p1');
            db.changeTracker.clear();

            await expect(lazy(requireDefined(post)).author).rejects.toThrow(/needs an entity tracked by this DbContext/);
            await db.dispose();
        });

        it('when the entity is Added', async () => {
            const db = await open();
            const post = new Post({
                id: 'new-post',
                authorId: 'a1',
                title: 'Pending',
            });
            db.posts.add(post);
            db.connection.statements.length = 0;
            await expect(lazy(post).author).rejects.toThrow(
                'Navigation loading is unavailable for an Added entity because it has no persisted identity.',
            );
            expect(db.connection.statements).toEqual([]);
            await db.dispose();
        });
        it('when the context is disposed', async () => {
            const db = await open();
            const post = await db.posts.find('p1');
            await db.dispose();

            await expect(lazy(requireDefined(post)).author).rejects.toThrow(/DbContext was disposed/);
        });

        it('when an entity was constructed rather than loaded', () => {
            const detached = new Post({ id: 'p9', authorId: 'a1', title: 'Never tracked' });

            expect(() => lazy(detached)).toThrow(/needs an entity tracked by a DbContext/);
        });
    });

    describe('N+1 budget', () => {
        it('throws once a context exceeds its lazy-load budget', async () => {
            // The practical answer to the N+1 objection: the loop fails in the test
            // that covers it rather than degrading quietly in production.
            lazyOptions = { enabled: true, maxPerContext: 1 };
            const db = await open();
            const posts = await db.posts.orderBy(post => post.id).toArray();

            await lazy(posts[0]).author;
            await expect(lazy(posts[1]).author).rejects.toThrow(/lazy loads, which is its configured maximum.*include\(\.\.\.\)/s);
            await db.dispose();
        });

        it('does not count a navigation that was already loaded', async () => {
            lazyOptions = { enabled: true, maxPerContext: 1 };
            const db = await open();
            const post = await db.posts.find('p1');

            await lazy(requireDefined(post)).author;
            // The second access resolves from memory, so it must not consume budget.
            await expect(lazy(requireDefined(post)).author).resolves.toBeInstanceOf(Author);
            await db.dispose();
        });

        it('rejects a budget that is not a positive integer', () => {
            expect(() => new DbContextOptionsBuilder().useLazyLoading({ maxPerContext: 0 }))
                .toThrow(/maxPerContext must be a positive integer/);
        });
    });
});
