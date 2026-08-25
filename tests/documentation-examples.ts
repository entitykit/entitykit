// Compile-only coverage for representative README.md and USAGE.md examples.
// Jest does not execute this file because it is intentionally not a *.test.ts.
import {
    DbContext,
    DbUpdateConcurrencyError,
    DeleteBehavior,
    defineEntityKitConfig,
    isEntityKitError,
    type DbContextOptionsBuilder,
    type ModelBuilder,
    type RuntimeDiagnosticEvent,
} from '@entitykit/core';
import { sqliteProviderServices } from '@entitykit/sqlite';
import { RecordingDatabaseConnection } from '@entitykit/testing';

class User {
    public id = '';
    public email = '';
    public name = '';
    public posts: Post[] = [];
}

class Post {
    public id = '';
    public authorId = '';
    public title = '';
    public status = 'draft';
    public author: User | null = null;
}

export class AppDbContext extends DbContext {
    public readonly users = this.set<User, [string]>(User);
    public readonly posts = this.set<Post, [string]>(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useSqlite('./app.db');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnType('text').isRequired();
            entity.hasIndex(user => user.email).isUnique();
        });

        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('text').isRequired();
            entity.property(post => post.authorId)
                .hasColumnName('author_id')
                .hasColumnType('text')
                .isRequired();
            entity.property(post => post.title).hasColumnType('text').isRequired();
            entity.property(post => post.status).hasColumnType('text').isRequired();
            entity.hasOne(User, post => post.author)
                .withMany(user => user.posts)
                .hasForeignKey(post => post.authorId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

export async function readmeExample(): Promise<void> {
    await using db = AppDbContext.create();
    await db.database.ensureCreated();

    const user = Object.assign(new User(), {
        id: 'usr_1',
        email: 'ada@example.com',
        name: 'Ada',
    });
    db.users.add(user);
    await db.saveChanges();

    const loaded = await db.users
        .where(candidate => candidate.email.eq('ada@example.com'))
        .single();
    loaded.name = 'Ada Lovelace';
    await db.saveChanges();
}

export async function queryExamples(db: AppDbContext): Promise<void> {
    const page = await db.users
        .where(user => user.email.endsWith('@example.com'))
        .orderBy(user => user.name)
        .skip(20)
        .take(20)
        .asNoTracking()
        .toArray();

    const cards = await db.users
        .where(user => user.email.endsWith('@example.com'))
        .select((user, project) => ({
            id: user.id,
            displayName: project.upper(user.name),
        }))
        .toArray();

    const totals = await db.posts
        .groupBy(post => ({ status: post.status }))
        .select(group => ({
            status: group.key.status,
            posts: group.count(),
        }))
        .toArray();

    const included = await db.users
        .where(candidate => candidate.id.eq('usr_1'))
        .include(candidate => candidate.posts
            .orderByDescending(post => post.id)
            .take(10))
        .single();
    await db.entry(included)?.collection(candidate => candidate.posts).load();

    void page;
    void cards;
    void totals;
}

export async function trackedWriteExamples(db: AppDbContext): Promise<void> {
    const created = Object.assign(new User(), {
        id: 'usr_2',
        email: 'grace@example.com',
        name: 'Grace',
    });
    db.users.add(created);
    await db.saveChanges();

    const loaded = await db.users.findOrThrow('usr_2');
    loaded.name = 'Grace Hopper';
    const plan = db.getSavePlanDebugView();
    const affected = await db.saveChanges();

    void plan;
    void affected;
}

export async function setBasedWriteExamples(db: AppDbContext): Promise<void> {
    await db.posts
        .where(post => post.status.eq('draft'))
        .executeUpdate({ status: 'published' });
    await db.posts
        .where(post => post.status.eq('archived'))
        .executeDelete();
    await db.posts.upsert(
        [Object.assign(new Post(), {
            id: 'post_2',
            authorId: 'usr_1',
            title: 'A typed unit of work',
            status: 'published',
        })],
        {
            updateProperties: ['title', 'status'],
        },
    );
}

export async function transactionExample(db: AppDbContext): Promise<void> {
    await db.transaction(async transaction => {
        transaction.posts.add(Object.assign(new Post(), {
            id: 'post_1',
            authorId: 'usr_1',
            title: 'Hello, EntityKit',
            status: 'published',
        }));
        await transaction.saveChanges();
        await transaction.database.execute`
            update users set name = ${'Ada Lovelace'} where id = ${'usr_1'}
        `;
    }, { isolationLevel: 'serializable' });
}

export async function rawSqlExamples(db: AppDbContext): Promise<void> {
    const rows = await db.database.sql<{
        status: string;
        total: number | string;
    }>`
        select status, count(*) as total
        from posts
        where author_id = ${'usr_1'}
        group by status
    `;
    const affected = await db.database.execute`
        update posts set status = ${'archived'} where id = ${'post_1'}
    `;
    const posts = await db.posts.fromSqlUnsafe`
        select id, author_id, title, status
        from posts
        where author_id = ${'usr_1'}
    `.toArray();
    const statement = db.database.rawSql`
        delete from posts where id = ${'post_1'}
    `;
    await db.database.executeStatement(statement);

    void rows;
    void affected;
    void posts;
}

export class DiagnosticDbContext extends AppDbContext {
    public static readonly events: RuntimeDiagnosticEvent[] = [];

    protected override configure(options: DbContextOptionsBuilder): void {
        super.configure(options);
        options.useDiagnostics(event => {
            DiagnosticDbContext.events.push(event);
        });
    }
}

export async function recordingConnectionExample(): Promise<void> {
    const connection = new RecordingDatabaseConnection();

    class TestDbContext extends AppDbContext {
        protected override configure(options: DbContextOptionsBuilder): void {
            options.useConnection(connection);
        }
    }

    connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });

    await using db = TestDbContext.create();
    await db.database.sql`select id from users`;

    expect(connection.statements).toEqual([
        { text: 'select id from users', values: [] },
    ]);
}

export async function errorExample(db: AppDbContext): Promise<void> {
    try {
        await db.saveChanges();
    } catch (error) {
        if (error instanceof DbUpdateConcurrencyError) {
            await error.entry?.resolveConcurrency('databaseWins');
            return;
        }
        if (isEntityKitError(error)) {
            void error.code;
            void error.toJSON();
        }
        throw error;
    }
}

export const entityKitConfig = defineEntityKitConfig({
    context: AppDbContext,
    provider: sqliteProviderServices,
    connection: './app.db',
    migrationsDir: 'src/db/migrations',
});
