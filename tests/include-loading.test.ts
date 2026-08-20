import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../packages/core/src';
import {
    DbContext,
    DeleteBehavior,
    type DatabaseConnection,
    type DatabaseQueryResult,
    type RuntimeDiagnosticEvent,
    type SqlStatement,
} from '../packages/core/src';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../packages/sqlite/src';

/**
 * What `include(...)` costs. Loading is batched per include level rather than
 * per parent, which is the difference between two statements and N+1 — so the
 * statement count is asserted against a real database rather than reasoned
 * about from the code.
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
    public comments?: Comment[];

    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

class Comment {
    public id!: string;
    public postId!: string;
    public body!: string;
    public post?: Post;

    constructor(data?: Partial<Comment>) {
        Object.assign(this, data);
    }
}

/** Records every statement that actually reaches the driver. */
class CountingConnection implements DatabaseConnection {
    private readonly inner = new SqliteDatabaseConnection(':memory:');
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

class IncludeDbContext extends DbContext {
    public authors = this.set(Author);
    public posts = this.set(Post);
    public comments = this.set(Comment);
    public readonly includeEvents: Array<Extract<RuntimeDiagnosticEvent, { kind: 'include' }>> = [];
    public readonly connection = new CountingConnection();

    constructor(private readonly parameterLimit?: number) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(
            this.connection,
            {
                provider: 'sqlite',
                dialect: this.parameterLimit === undefined
                    ? sqliteProviderServices.dialect
                    : {
                        ...sqliteProviderServices.dialect,
                        maxStatementParameters: () => this.parameterLimit,
                    },
                migrationDialect: sqliteProviderServices.migrationDialect,
                createMigrationBuilder:
                    sqliteProviderServices.createMigrationBuilder,
            },
        );
        options.useDiagnostics(event => {
            if (event.kind === 'include') {
                this.includeEvents.push(event);
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
        model.entity(Comment, entity => {
            entity.toTable('comments');
            entity.hasKey(comment => comment.id);
            entity.property(comment => comment.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(comment => comment.postId).hasColumnName('post_id').hasColumnType('text').isRequired();
            entity.property(comment => comment.body).hasColumnName('body').hasColumnType('text').isRequired();
            entity.hasOne(Post, comment => comment.post).withMany(post => post.comments)
                .hasForeignKey(comment => comment.postId).onDelete(DeleteBehavior.Cascade);
        });
    }
}

async function seed(
    authors: number,
    postsPerAuthor: number,
    commentsPerPost = 0,
    parameterLimit?: number,
): Promise<IncludeDbContext> {
    const db =  IncludeDbContext.create(parameterLimit);
    await db.database.connection.query({ text: 'create table authors (id text primary key, name text not null)', values: [] });
    await db.database.connection.query({ text: 'create table posts (id text primary key, author_id text not null, title text not null)', values: [] });
    await db.database.connection.query({ text: 'create table comments (id text primary key, post_id text not null, body text not null)', values: [] });

    for (let a = 0; a < authors; a++) {
        db.authors.add(new Author({ id: `a${String(a)}`, name: `Author ${String(a)}` }));
    }
    await db.saveChanges();

    for (let a = 0; a < authors; a++) {
        for (let p = 0; p < postsPerAuthor; p++) {
            db.posts.add(new Post({ id: `a${String(a)}p${String(p)}`, authorId: `a${String(a)}`, title: `Post ${String(a)}-${String(p)}` }));
        }
    }
    if (postsPerAuthor > 0) {
        await db.saveChanges();
    }

    for (let a = 0; a < authors; a++) {
        for (let p = 0; p < postsPerAuthor; p++) {
            for (let c = 0; c < commentsPerPost; c++) {
                db.comments.add(new Comment({ id: `a${String(a)}p${String(p)}c${String(c)}`, postId: `a${String(a)}p${String(p)}`, body: 'b' }));
            }
        }
    }
    if (commentsPerPost > 0) {
        await db.saveChanges();
    }

    db.changeTracker.clear();
    db.connection.statements.length = 0;
    db.includeEvents.length = 0;
    return db;
}

describe('include loading', () => {
    it('loads a collection in one extra statement, not one per parent', async () => {
        const db = await seed(50, 3);

        const authors = await db.authors.include(author => author.posts).toArray();

        expect(authors).toHaveLength(50);
        expect(authors.reduce((total, author) => total + (author.posts?.length ?? 0), 0)).toBe(150);
        // The root query plus one batched load. N+1 would be 51.
        expect(db.connection.statements).toHaveLength(2);
        await db.dispose();
    });

    it('costs one statement per include level, not per row', async () => {
        const db = await seed(20, 2, 2);

        const authors = await db.authors.include(author => author.posts).thenInclude(post => post.comments).toArray();

        const comments = authors.flatMap(author => author.posts ?? [])
            .reduce((total, post) => total + (post.comments?.length ?? 0), 0);
        expect(comments).toBe(80);
        expect(db.connection.statements).toHaveLength(3);
        await db.dispose();
    });

    it('loads sibling includes in one statement each', async () => {
        const db = await seed(15, 2);

        await db.authors.include(author => author.posts).toArray();
        const afterOne = db.connection.statements.length;

        db.changeTracker.clear();
        db.connection.statements.length = 0;
        await db.posts.include(post => post.author).include(post => post.comments).toArray();

        expect(afterOne).toBe(2);
        expect(db.connection.statements).toHaveLength(3);
        await db.dispose();
    });

    it('reports each include to diagnostics with its strategy and counts', async () => {
        const db = await seed(10, 2);

        await db.authors.include(author => author.posts).toArray();

        expect(db.includeEvents).toHaveLength(1);
        expect(db.includeEvents[0]).toMatchObject({
            kind: 'include',
            parentEntityName: 'Author',
            relatedEntityName: 'Post',
            navigationProperty: 'posts',
            strategy: 'splitQuery',
            parentCount: 10,
            keyCount: 10,
            rowCount: 20,
        });
        await db.dispose();
    });

    it('splits a parent set too large to bind into statements that fit', async () => {
    // This test dialect lowers SQLite's real 32_766 cap to 100. The key list is
    // EntityKit's own construction, so it is split and concatenated — where a
    // caller's oversized `in([...])` is refused as caller-owned data.
        const db = await seed(50, 0, 0, 100);

        const authors = await db.authors.include(author => author.posts).toArray();

        expect(authors).toHaveLength(50);
        // Root query plus two chunks.
        expect(db.connection.statements).toHaveLength(3);
        await db.dispose();
    }, 120000);

    it('does not split a parent set that fits', async () => {
        const db = await seed(1000, 1);

        await db.authors.include(author => author.posts).toArray();

        expect(db.connection.statements).toHaveLength(2);
        await db.dispose();
    }, 60000);
});
