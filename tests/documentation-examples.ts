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
import { createSqliteDataSource, sqliteProviderServices } from '@entitykit/sqlite';
import { RecordingDatabaseConnection } from '@entitykit/testing';

interface NewUser { id: string; email: string; name: string }

class User {
    public id: string;
    public email: string;
    public name: string;
    public posts: Post[] = [];

    constructor(input: NewUser) {
        this.id = input.id;
        this.email = input.email;
        this.name = input.name;
    }
}

interface NewPost { id: string; authorId: string; title: string; status?: string }

class Post {
    public id: string;
    public authorId: string;
    public title: string;
    public status = 'draft';
    public author: User | null = null;

    constructor(input: NewPost) {
        this.id = input.id;
        this.authorId = input.authorId;
        this.title = input.title;
        this.status = input.status ?? 'draft';
    }
}

export class AppDbContext extends DbContext {
    public readonly users = this.set(User);
    public readonly posts = this.set(Post);

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnType('text').isRequired();
            entity.materializeChecked(row => new User({
                id: row.required(user => user.id),
                email: row.required(user => user.email),
                name: row.required(user => user.name),
            }));
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
            entity.materializeChecked(row => new Post({
                id: row.required(post => post.id),
                authorId: row.required(post => post.authorId),
                title: row.required(post => post.title),
                status: row.required(post => post.status),
            }));
            entity.hasOne(User, post => post.author)
                .withMany(user => user.posts)
                .hasForeignKey(post => post.authorId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

export async function readmeExample(): Promise<void> {
    const dataSource = createSqliteDataSource('./app.db');
    try {
        await using db = dataSource.createContext(AppDbContext);
        await db.database.ensureCreated();
        db.users.create({
            id: 'usr_1',
            email: 'ada@example.com',
            name: 'Ada',
        });
        await db.saveChanges();
        const loaded = await db.users
            .where(candidate => candidate.email.eq('ada@example.com'))
            .single();
        loaded.name = 'Ada Lovelace';
        await db.saveChanges();
    } finally {
        await dataSource.dispose();
    }
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
    const posts = db.entryOrThrow(included).collection(candidate => candidate.posts);
    if (!posts.isLoaded) await posts.load();

    void page;
    void cards;
    void totals;
}

export async function trackedWriteExamples(db: AppDbContext): Promise<void> {
    db.users.create({
        id: 'usr_2',
        email: 'grace@example.com',
        name: 'Grace',
    });
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
    await db.posts.executeUpsert(
        [new Post({
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
        transaction.posts.create({
            id: 'post_1',
            authorId: 'usr_1',
            title: 'Hello, EntityKit',
            status: 'published',
        });
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

class MigrationDbContext extends AppDbContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useSqlite('./app.db');
    }
}

export const entityKitConfig = defineEntityKitConfig({
    context: MigrationDbContext,
    provider: sqliteProviderServices,
    connection: './app.db',
    migrationsDir: 'src/db/migrations',
});
