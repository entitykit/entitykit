import type {
    DatabaseConnection,
    DbContextOptionsBuilder,
    ModelBuilder,
    RuntimeDiagnosticEvent,
} from '../src';
import {
    ContextConcurrentOperationError,
    ContextDisposedError,
    DbContext,
    EntityState,
    OperationCanceledError,
    ProviderCapabilityError,
    QueryCompilationError,
    type Queryable,
} from '../src';
import { RecordingDatabaseConnection } from '../src/testing';
import { RecordingDatabaseConnection as BufferedOnlyConnection } from './support/recording-database-connection';

class StreamUser {
    public id!: string;
    public email!: string;
    public posts?: StreamPost[];

    constructor(data?: Partial<StreamUser>) {
        Object.assign(this, data);
    }
}

class StreamPost {
    public id!: string;
    public userId!: string;
    public user?: StreamUser;

    constructor(data?: Partial<StreamPost>) {
        Object.assign(this, data);
    }
}

class StreamingDbContext extends DbContext {
    public static connection: DatabaseConnection;
    public static events: RuntimeDiagnosticEvent[] = [];
    public users = this.set(StreamUser);
    public posts = this.set(StreamPost);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(StreamingDbContext.connection);
        options.useDiagnostics(event => StreamingDbContext.events.push(event));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(StreamUser, entity => {
            entity.toTable('stream_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        });
        model.entity(StreamPost, entity => {
            entity.toTable('stream_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.userId).hasColumnName('user_id').hasColumnType('text').isRequired();
            entity.hasOne(StreamUser, post => post.user)
                .withMany(user => user.posts)
                .hasForeignKey(post => post.userId);
        });
    }
}

function createDb(connection: DatabaseConnection): StreamingDbContext {
    StreamingDbContext.connection = connection;
    StreamingDbContext.events = [];
    return StreamingDbContext.create();
}

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows) {
        values.push(row);
    }
    return values;
}

describe('query streaming', () => {
    it('lazily streams and tracks materialized entities', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [
                { id: 'user_1', email: 'one@example.com' },
                { id: 'user_2', email: 'two@example.com' },
            ],
        });

        const stream = db.users.orderBy(user => user.id).stream({ batchSize: 1 });
        expect(connection.operations).toEqual([]);

        const users = await collect(stream);

        expect(users).toEqual([
            expect.objectContaining({ id: 'user_1', email: 'one@example.com' }),
            expect.objectContaining({ id: 'user_2', email: 'two@example.com' }),
        ]);
        expect(users.every(user => user instanceof StreamUser)).toBe(true);
        expect(db.entry(users[0])?.state).toBe(EntityState.Unchanged);
        expect(db.entry(users[1])?.state).toBe(EntityState.Unchanged);
        expect(connection.operations).toEqual([{
            kind: 'stream',
            statement: {
                text: 'select "id", "email" from "stream_users" order by "id" asc',
                values: [],
            },
        }]);
    });

    it('releases the context lock and temporary tracker after early disposal', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [
                { id: 'user_1', email: 'one@example.com' },
                { id: 'user_2', email: 'two@example.com' },
            ],
        });

        let first: StreamUser | undefined;
        for await (const user of db.users.asNoTracking().stream({ batchSize: 1 })) {
            first = user;
            break;
        }

        expect(first).toBeInstanceOf(StreamUser);
        if (!first) {
            throw new Error('Expected the stream to yield one user.');
        }
        expect(db.entry(first)).toBeUndefined();
        connection.queueResult({ rows: [{ count: 2 }] });
        await expect(db.users.count()).resolves.toBe(2);
        const queryEvent = StreamingDbContext.events.find(event =>
            event.kind === 'query' && event.rowCount === 1,
        );
        const planEvent = StreamingDbContext.events.find(event =>
            event.kind === 'queryPlan'
            && event.phase === 'execute'
            && event.shape.operation === 'stream',
        );
        expect(queryEvent).toBeDefined();
        expect(planEvent).toMatchObject({ resultCount: 1, rowCount: 1 });
    });

    it('rejects overlapping context work until the iterator is closed', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [
                { id: 'user_1', email: 'one@example.com' },
                { id: 'user_2', email: 'two@example.com' },
            ],
        });
        const iterator = db.users.stream({ batchSize: 1 })[Symbol.asyncIterator]();

        await expect(iterator.next()).resolves.toMatchObject({ done: false });
        await expect(db.users.count()).rejects.toBeInstanceOf(
            ContextConcurrentOperationError,
        );
        await iterator.return?.();

        connection.queueResult({ rows: [{ count: 2 }] });
        await expect(db.users.count()).resolves.toBe(2);
    });

    it('normalizes AbortSignal cancellation and leaves the context reusable', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        const controller = new AbortController();
        connection.queueResult({
            rows: [
                { id: 'user_1', email: 'one@example.com' },
                { id: 'user_2', email: 'two@example.com' },
            ],
        });
        const iterator = db.users.stream({
            batchSize: 1,
            signal: controller.signal,
        })[Symbol.asyncIterator]();

        await expect(iterator.next()).resolves.toMatchObject({ done: false });
        controller.abort('test cancellation');
        await expect(iterator.next()).rejects.toMatchObject({
            code: 'OPERATION_CANCELED',
            name: OperationCanceledError.name,
        });

        connection.queueResult({ rows: [{ count: 2 }] });
        await expect(db.users.count()).resolves.toBe(2);
    });

    it('streams projections, joins, aggregates, and mapped raw SQL', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({ rows: [{ email: 'one@example.com' }] });
        connection.queueResult({ rows: [{ rootId: 'user_1', peerEmail: 'one@example.com' }] });
        connection.queueResult({ rows: [{ total: '2' }] });
        connection.queueResult({ rows: [{ id: 'user_1', email: 'one@example.com' }] });

        await expect(collect(db.users.select(user => ({ email: user.email })).stream()))
            .resolves.toEqual([{ email: 'one@example.com' }]);
        await expect(collect(db.users
            .join('peer', db.users, ({ root, peer }) => root.id.eq(peer.id))
            .select(({ root, peer }) => ({ rootId: root.id, peerEmail: peer.email }))
            .stream()))
            .resolves.toEqual([{ rootId: 'user_1', peerEmail: 'one@example.com' }]);
        await expect(collect(db.users.aggregate(aggregate => ({
            total: aggregate.count(),
        })).stream()))
            .resolves.toEqual([{ total: 2 }]);
        const rawUsers = await collect(db.users
            .fromSql`select id, email from stream_users`
            .asNoTracking()
            .stream());
        expect(rawUsers).toEqual([
            expect.objectContaining({ id: 'user_1', email: 'one@example.com' }),
        ]);
        expect(db.entry(rawUsers[0])).toBeUndefined();
        expect(connection.operations.map(operation => operation.kind))
            .toEqual(['stream', 'stream', 'stream', 'stream']);
    });

    it('rechecks raw-query lifecycle when stream iteration begins', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [{ id: 'user_1', email: 'one@example.com' }],
        });
        const stream = db.users
            .fromSql`select id, email from stream_users`
            .stream();

        await db.dispose();

        await expect(collect(stream)).rejects.toBeInstanceOf(
            ContextDisposedError,
        );
        expect(connection.operations).toEqual([]);
    });

    it('rejects a partial tracked raw row before streaming it', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({ rows: [{ id: 'user_1' }] });

        await expect(collect(
            db.users.fromSql`select id from stream_users`.stream(),
        )).rejects.toBeInstanceOf(QueryCompilationError);
        expect(db.changeTracker.entries()).toEqual([]);
    });

    it('rejects includes, invalid batches, and providers without streaming', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);

        const included = db.users.include(user => user.posts);
        expect(() => (included as unknown as Queryable<StreamUser>).stream())
            .toThrow(QueryCompilationError);
        expect(() => db.users.stream({ batchSize: 0 }))
            .toThrow(/batchSize must be a positive safe integer/);

        const bufferedDb = createDb(new BufferedOnlyConnection());
        await expect(collect(bufferedDb.users.stream()))
            .rejects.toBeInstanceOf(ProviderCapabilityError);
    });
});
