import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    QueryPlanDiagnosticEvent,
    RuntimeDiagnosticEvent,
} from '../src';
import { DbContext, lazy } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class Reader {
    public id!: string;
    public email!: string;
    public posts!: ReaderPost[];
}

class ReaderPost {
    public id!: string;
    public readerId!: string;
    public title!: string;
    public reader!: Reader;
}

class NoTrackingContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static events: RuntimeDiagnosticEvent[] = [];

    public readers = this.set(Reader);
    public posts = this.set(ReaderPost);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(NoTrackingContext.connection);
        options.useLazyLoading();
        options.useDiagnostics(event => NoTrackingContext.events.push(event));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Reader, entity => {
            entity.toTable('readers');
            entity.hasKey(reader => reader.id);
            entity.property(reader => reader.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(reader => reader.email)
                .hasColumnName('email').hasColumnType('text').isRequired();
        });
        model.entity(ReaderPost, entity => {
            entity.toTable('reader_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.readerId)
                .hasColumnName('reader_id').hasColumnType('text').isRequired();
            entity.property(post => post.title)
                .hasColumnName('title').hasColumnType('text').isRequired();
            entity.hasOne(Reader, post => post.reader)
                .withMany(reader => reader.posts)
                .hasForeignKey(post => post.readerId);
        });
    }
}

function createDb(connection = new RecordingDatabaseConnection()): NoTrackingContext {
    NoTrackingContext.connection = connection;
    NoTrackingContext.events = [];
    return NoTrackingContext.create();
}

describe('no-tracking entity queries', () => {
    it('does not reuse or add entities in the context identity map', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [{ id: 'r1', email: 'fresh@example.com' }],
            rowCount: 1,
        });
        const db = createDb(connection);
        const tracked = {
            id: 'r1',
            email: 'tracked@example.com',
        } as Reader;
        db.readers.attach(tracked);

        const result = await db.readers.asNoTracking().single();

        expect(result).not.toBe(tracked);
        expect(result.email).toBe('fresh@example.com');
        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(db.entry(result)).toBeUndefined();
    });

    it('keeps identity resolution within a no-tracking include graph', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'p1', reader_id: 'r1', title: 'first' },
                { id: 'p2', reader_id: 'r1', title: 'second' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [{ id: 'r1', email: 'reader@example.com' }],
            rowCount: 1,
        });
        const db = createDb(connection);

        const posts = await db.posts
            .asNoTracking()
            .include(post => post.reader)
            .orderBy(post => post.id)
            .toArray();

        expect(posts[0]?.reader).toBe(posts[1]?.reader);
        expect(posts[0]?.reader.posts).toBeUndefined();
        expect(db.changeTracker.entries()).toEqual([]);
        expect(() => lazy(posts[0]))
            .toThrow('needs an entity tracked by a DbContext');
    });

    it('does not retain identity state for unsafe raw rows', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'r1', email: 'reader@example.com' },
                { id: 'r1', email: 'reader@example.com' },
            ],
            rowCount: 2,
        });
        const db = createDb(connection);

        const readers = await db.readers
            .fromSqlUnsafe`select id, email from readers`
            .asNoTracking()
            .toArray();

        expect(readers[0]).not.toBe(readers[1]);
        expect(db.changeTracker.entries()).toEqual([]);
    });

    it('reports no-tracking behavior in query-plan diagnostics', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db = createDb(connection);

        await db.readers.asNoTracking().toArray();

        const compile = NoTrackingContext.events.find(
            (event): event is QueryPlanDiagnosticEvent =>
                event.kind === 'queryPlan' && event.phase === 'compile',
        );
        expect(compile?.shape.trackingBehavior).toBe('noTracking');
    });
});
