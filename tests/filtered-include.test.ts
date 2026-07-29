import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import type { SqlDialect } from '../src/adapter';
import { sqliteDialect } from '../src/providers/sqlite/sqlite-dialect';
import { mySqlDialect } from '../src/providers/mysql/mysql-dialect';
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
    public static dialect?: SqlDialect;

    public users = this.set(User);
    public posts = this.set(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        if (IncludeContext.dialect) {
            options.useConnection(IncludeContext.connection, {
                provider: IncludeContext.dialect.name,
                dialect: IncludeContext.dialect,
            });
            return;
        }

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
    IncludeContext.dialect = undefined;
    return IncludeContext.create();
}

function createDbWithDialect(connection: RecordingDatabaseConnection, dialect: SqlDialect): IncludeContext {
    IncludeContext.connection = connection;
    IncludeContext.dialect = dialect;
    return IncludeContext.create();
}

const fallbackDialect: SqlDialect = {
    name: 'fallback-sql',
    quoteIdentifier(identifier: string): string {
        return `[${identifier}]`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        return identifiers.filter(Boolean).map(identifier => this.quoteIdentifier(requireDefined(identifier))).join('.');
    },
    parameter(): string {
        return '?';
    },
    countAllExpression(): string {
        return 'count(*)';
    },
    falsePredicate(): string {
        return '0 = 1';
    },
    insertConflictDoNothingClause(): string {
        return 'on conflict do nothing';
    },
};

describe('filtered includes', () => {
    it('does not issue include queries when the root query returns no parents', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  createDb(connection);

        const users = await db.users.include(user => user.posts).toArray();

        expect(users).toEqual([]);
        expect(connection.statements).toEqual([
            {
                text: 'select "id", "email" from "users"',
                values: [],
            },
        ]);
    });

    it('applies collection include predicates and ordering to the split query', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'a@example.com' },
                { id: 'usr_2', email: 'b@example.com' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'Alpha', author_id: 'usr_1' }],
            rowCount: 1,
        });
        const db =  createDb(connection);

        const users = await db.users
            .include(user => user.posts.where(post => post.title.like('A%')).orderByDescending(post => post.id))
            .toArray();

        expect(connection.statements).toEqual([
            {
                text: 'select "id", "email" from "users"',
                values: [],
            },
            {
                text: 'select "id", "title", "author_id" from "posts" where ("author_id" in ($1, $2) and "title" like $3) order by "id" desc',
                values: ['usr_1', 'usr_2', 'A%'],
            },
        ]);
        expect(users[0]?.posts).toHaveLength(1);
        expect(users[1]?.posts).toEqual([]);
    });

    it('deduplicates collection include rows by tracked identity and keeps first values', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [{ id: 'usr_1', email: 'a@example.com' }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'First', author_id: 'usr_1' },
                { id: 'post_1', title: 'Second', author_id: 'usr_1' },
            ],
            rowCount: 2,
        });
        const db =  createDb(connection);

        const users = await db.users.include(user => user.posts).toArray();

        expect(users[0]?.posts).toHaveLength(1);
        expect(users[0]?.posts[0]).toBeInstanceOf(Post);
        expect(users[0]?.posts[0]?.title).toBe('First');
        expect(users[0]?.posts[0]?.author).toBe(users[0]);
        expect(db.changeTracker.entries()).toHaveLength(2);
    });

    it('uses a windowed split query when filtered includes use take', async () => {
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
                { __entitykit_parent_key: 'usr_1', id: 'post_1', title: 'One', author_id: 'usr_1' },
                { __entitykit_parent_key: 'usr_2', id: 'post_2', title: 'Two', author_id: 'usr_2' },
            ],
            rowCount: 2,
        });
        const db =  createDb(connection);

        const users = await db.users
            .include(user => user.posts.orderByDescending(post => post.id).take(1))
            .toArray();

        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('row_number() over (partition by "t"."author_id" order by "t"."id" desc)');
        expect(connection.statements[1]?.text).toContain('where "t"."author_id" in ($1, $2)');
        expect(connection.statements[1]?.text).toContain('where "__entitykit_include"."__entitykit_include_row_number" <= $3');
        expect(connection.statements[1]?.values).toEqual(['usr_1', 'usr_2', 1]);
        expect(users[0]?.posts.map(post => post.id)).toEqual(['post_1']);
        expect(users[1]?.posts.map(post => post.id)).toEqual(['post_2']);
    });

    it('keeps skip and take per parent in a windowed split query', async () => {
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
                { __entitykit_parent_key: 'usr_1', id: 'post_2', title: 'Two', author_id: 'usr_1' },
                { __entitykit_parent_key: 'usr_2', id: 'post_4', title: 'Four', author_id: 'usr_2' },
            ],
            rowCount: 2,
        });
        const db =  createDb(connection);

        const users = await db.users
            .include(user => user.posts.orderBy(post => post.id).skip(1).take(1))
            .toArray();

        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('row_number() over (partition by "t"."author_id" order by "t"."id" asc)');
        expect(connection.statements[1]?.text).toContain('where "t"."author_id" in ($1, $2)');
        expect(connection.statements[1]?.text).toContain('where "__entitykit_include"."__entitykit_include_row_number" > $3 and "__entitykit_include"."__entitykit_include_row_number" <= $4');
        expect(connection.statements[1]?.values).toEqual(['usr_1', 'usr_2', 1, 2]);
        expect(users[0]?.posts.map(post => post.id)).toEqual(['post_2']);
        expect(users[1]?.posts.map(post => post.id)).toEqual(['post_4']);
    });

    it('uses a windowed split query for SQLite, placing nulls SQL-standard', async () => {
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
                { __entitykit_parent_key: 'usr_1', id: 'post_1', title: 'One', author_id: 'usr_1' },
                { __entitykit_parent_key: 'usr_2', id: 'post_2', title: 'Two', author_id: 'usr_2' },
            ],
            rowCount: 2,
        });
        const db =  createDbWithDialect(connection, sqliteDialect);

        const users = await db.users
            .include(user => user.posts.orderByDescending(post => post.id).take(1))
            .toArray();

        // A single windowed query, not one query per parent: SQLite has window
        // functions, so it takes the same batched path as Postgres. `nulls first`
        // keeps descending null placement SQL-standard, matching the top-level order.
        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('row_number() over (partition by "t"."author_id" order by "t"."id" desc nulls first)');
        expect(connection.statements[1]?.text).toContain('where "t"."author_id" in (?, ?)');
        expect(connection.statements[1]?.text).toContain('where "__entitykit_include"."__entitykit_include_row_number" <= ?');
        expect(connection.statements[1]?.values).toEqual(['usr_1', 'usr_2', 1]);
        expect(users[0]?.posts.map(post => post.id)).toEqual(['post_1']);
        expect(users[1]?.posts.map(post => post.id)).toEqual(['post_2']);
    });

    it('uses a windowed split query for MySQL, placing nulls SQL-standard', async () => {
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
                { __entitykit_parent_key: 'usr_1', id: 'post_1', title: 'One', author_id: 'usr_1' },
                { __entitykit_parent_key: 'usr_2', id: 'post_2', title: 'Two', author_id: 'usr_2' },
            ],
            rowCount: 2,
        });
        const db =  createDbWithDialect(connection, mySqlDialect);

        const users = await db.users
            .include(user => user.posts.orderBy(post => post.id).take(1))
            .toArray();

        // MySQL 8 has window functions too. It has no `NULLS LAST`, so the leading
        // `(col is null)` term is how it keeps ascending nulls SQL-standard.
        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('row_number() over (partition by `t`.`author_id` order by `t`.`id` is null asc, `t`.`id` asc)');
        expect(connection.statements[1]?.text).toContain('where `t`.`author_id` in (?, ?)');
        expect(connection.statements[1]?.values).toEqual(['usr_1', 'usr_2', 1]);
        expect(users[0]?.posts.map(post => post.id)).toEqual(['post_1']);
        expect(users[1]?.posts.map(post => post.id)).toEqual(['post_2']);
    });

    it('keeps the per-parent fallback for a dialect without window-function support', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'a@example.com' },
                { id: 'usr_2', email: 'b@example.com' },
            ],
            rowCount: 2,
        });
        connection.queueResult({ rows: [{ id: 'post_1', title: 'One', author_id: 'usr_1' }], rowCount: 1 });
        connection.queueResult({ rows: [{ id: 'post_2', title: 'Two', author_id: 'usr_2' }], rowCount: 1 });
        // fallbackDialect does not declare supportsWindowFunctions, so an unknown
        // provider is never handed a window it may not be able to run.
        const db =  createDbWithDialect(connection, fallbackDialect);

        const users = await db.users
            .include(user => user.posts.orderBy(post => post.id).take(1))
            .toArray();

        expect(connection.statements).toHaveLength(3);
        expect(connection.statements[1]?.text).toBe('select [id], [title], [author_id] from [posts] where [author_id] in (?) order by [id] asc limit ?');
        expect(connection.statements[1]?.values).toEqual(['usr_1', 1]);
        expect(connection.statements[2]?.text).toBe('select [id], [title], [author_id] from [posts] where [author_id] in (?) order by [id] asc limit ?');
        expect(connection.statements[2]?.values).toEqual(['usr_2', 1]);
        expect(users[0]?.posts.map(post => post.id)).toEqual(['post_1']);
        expect(users[1]?.posts.map(post => post.id)).toEqual(['post_2']);
    });
});
