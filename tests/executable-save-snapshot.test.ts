import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    OutboxMessage,
} from '../src';
import { DbContext, EntityState } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class UnstableRecord {
    private idFallback = '';
    private nameFallback = '';
    private tokenFallback = '';
    private readonly reads: Map<string, unknown[]> = new Map();
    public events: OutboxMessage[] = [];

    public get id(): string {
        return this.next('id', this.idFallback);
    }

    public set id(value: string) {
        this.idFallback = value;
    }

    public get name(): string {
        return this.next('name', this.nameFallback);
    }

    public set name(value: string) {
        this.nameFallback = value;
    }

    public get token(): string {
        return this.next('token', this.tokenFallback);
    }

    public set token(value: string) {
        this.tokenFallback = value;
    }

    public returnOnReads(
        property: 'id' | 'name' | 'token',
        ...values: unknown[]
    ): void {
        this.reads.set(property, [...values]);
    }

    private next<TValue>(property: string, fallback: TValue): TValue {
        const queued = this.reads.get(property);
        return (queued?.length ? queued.shift() : fallback) as TValue;
    }
}

class SnapshotContext extends DbContext {
    public records = this.set(UnstableRecord);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useOutbox({
            tableName: 'app_outbox',
            collectEvents: entity => entity instanceof UnstableRecord
                ? entity.events
                : [],
            clearEvents: (entity, events) => {
                if (entity instanceof UnstableRecord) {
                    const persisted = new Set(events);
                    entity.events = entity.events.filter(event =>
                        !persisted.has(event));
                }
            },
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(UnstableRecord, entity => {
            entity.toTable('unstable_records');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnType('text').isRequired();
            entity.property(item => item.token).hasColumnType('text').isRequired()
                .isConcurrencyToken();
            entity.ignore(item => item.events);
        });
    }
}

function record(id: string, name: string): UnstableRecord {
    const item = new UnstableRecord();
    item.id = id;
    item.name = name;
    item.token = 'token-0';
    return item;
}

describe('executable save snapshots', () => {
    it('uses one captured value for a single insert and acceptance', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = SnapshotContext.create(connection);
        const item = record('record-1', 'fallback');
        db.records.add(item);
        item.returnOnReads('name', 'database-value', 'memory-value');
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements[0]?.values).toEqual([
            'record-1',
            'database-value',
            'token-0',
        ]);
        expect(db.entry(item)?.originalValues.name).toBe('database-value');
    });

    it('uses each captured row for batch inserts and acceptance', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = SnapshotContext.create(connection);
        const first = record('record-1', 'first-fallback');
        const second = record('record-2', 'second-fallback');
        db.records.add(first);
        db.records.add(second);
        first.returnOnReads('name', 'first-database', 'first-memory');
        second.returnOnReads('name', 'second-database', 'second-memory');
        connection.queueResult({ rowCount: 2 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(connection.statements[0]?.values).toEqual([
            'record-1',
            'first-database',
            'token-0',
            'record-2',
            'second-database',
            'token-0',
        ]);
        expect(db.entry(first)?.originalValues.name).toBe('first-database');
        expect(db.entry(second)?.originalValues.name).toBe('second-database');
    });

    it('derives update assignments and acceptance from the captured values', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = SnapshotContext.create(connection);
        const item = record('record-1', 'original');
        db.records.attach(item);
        item.name = 'memory-fallback';
        item.returnOnReads('name', 'database-value', 'later-value');
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements[0]?.values).toEqual([
            'database-value',
            'record-1',
            'token-0',
        ]);
        expect(db.entry(item)?.originalValues.name).toBe('database-value');
    });

    it('rejects a captured delete key that differs from the tracked identity', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = SnapshotContext.create(connection);
        const item = record('record-1', 'original');
        db.records.attach(item);
        db.records.remove(item);
        item.returnOnReads('id', 'database-key', 'wrong-key');

        await expect(db.saveChanges()).rejects.toThrow(
            'Primary key changes are not supported for entity \'UnstableRecord\' (property \'id\').',
        );

        expect(connection.statements).toEqual([]);
        expect(db.entry(item)?.state).toBe(EntityState.Deleted);
    });

    it('uses the captured concurrency value for both SQL and acceptance', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = SnapshotContext.create(connection);
        const item = record('record-1', 'original');
        db.records.attach(item);
        item.token = 'token-fallback';
        item.returnOnReads('token', 'database-token', 'later-token');
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements[0]?.values).toEqual([
            'database-token',
            'record-1',
            'token-0',
        ]);
        expect(db.entry(item)?.originalValues.token).toBe('database-token');
    });

    it('derives automatic outbox identity from the entity write snapshot', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = SnapshotContext.create(connection);
        const item = record('fallback-key', 'created');
        item.events = [{ type: 'Created', payload: { ok: true } }];
        db.records.add(item);
        item.returnOnReads('id', 'database-key', 'wrong-key');
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements[0]?.values[0]).toBe('database-key');
        expect(connection.statements[1]?.values[2]).toBe('database-key');
        expect(db.entry(item)?.originalValues.id).toBe('database-key');
        expect(item.events).toEqual([]);
    });
});

class GeneratedPrincipal {
    public id!: number;
    public name!: string;
}

class GeneratedDependent {
    private parentIdFallback?: number;
    private parentIdReads: Array<number | undefined> = [];
    public id!: string;
    public parent!: GeneratedPrincipal;

    public get parentId(): number | undefined {
        return this.parentIdReads.length > 0
            ? this.parentIdReads.shift()
            : this.parentIdFallback;
    }

    public set parentId(value: number | undefined) {
        this.parentIdFallback = value;
    }

    public returnParentIds(...values: Array<number | undefined>): void {
        this.parentIdReads = [...values];
    }
}

class GeneratedGraphContext extends DbContext {
    public parents = this.set(GeneratedPrincipal);
    public children = this.set(GeneratedDependent);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedPrincipal, entity => {
            entity.toTable('generated_parents');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
        model.entity(GeneratedDependent, entity => {
            entity.toTable('generated_children');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.parentId).hasColumnType('integer').isRequired();
            entity.hasOne(GeneratedPrincipal, item => item.parent)
                .withMany()
                .hasForeignKey(item => item.parentId);
        });
    }
}

describe('generated graph executable snapshots', () => {
    it('merges a generated principal key into the dependent snapshot', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = GeneratedGraphContext.create(connection);
        const parent = Object.assign(new GeneratedPrincipal(), { name: 'parent' });
        const child = Object.assign(new GeneratedDependent(), {
            id: 'child-1',
            parent,
        });
        db.children.add(child);
        db.parents.add(parent);
        child.returnParentIds(undefined, undefined, 999);
        connection.queueResult({ rows: [{ id: 71 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(connection.statements[1]?.values).toEqual(['child-1', 71]);
        expect(db.entry(child)?.originalValues.parentId).toBe(71);
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
    });
});
