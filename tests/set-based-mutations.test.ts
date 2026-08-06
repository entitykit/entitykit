import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import {
    DbContext,
    EntityState,
    QueryCompilationError,
    TenantOwnershipError,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class Task {
    public id!: string;
    public title!: string;
    public status!: string;
    public tenantId!: string;
    public archived!: boolean;

    constructor(data?: Partial<Task>) {
        Object.assign(this, data);
    }
}

function defineModel(model: ModelBuilder): void {
    model.entity(Task, entity => {
        entity.toTable('tasks');
        entity.hasKey(task => task.id);
        entity.property(task => task.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(task => task.title).hasColumnName('title').hasColumnType('text').isRequired();
        entity.property(task => task.status).hasColumnName('status').hasColumnType('text').isRequired();
        entity.property(task => task.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
        entity.property(task => task.archived).hasColumnName('archived').hasColumnType('boolean').isRequired();
    });
}

class RecordingContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public tasks = this.set(Task);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(RecordingContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        defineModel(model);
    }
}

class TenantContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public tasks = this.set(Task);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(TenantContext.connection);
        options.useTenantScope(() => 'tenant_1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Task, entity => {
            entity.toTable('tasks');
            entity.hasKey(task => task.id);
            entity.property(task => task.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(task => task.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(task => task.status).hasColumnName('status').hasColumnType('text').isRequired();
            entity.property(task => task.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            entity.property(task => task.archived).hasColumnName('archived').hasColumnType('boolean').isRequired();
            entity.tenantKey(task => task.tenantId);
        });
    }
}

class SqliteContext extends DbContext {
    public tasks = this.set(Task);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        defineModel(model);
    }
}

describe('set-based mutation SQL', () => {
    it('compiles executeUpdate() to a single update statement', async () => {
        const connection = new RecordingDatabaseConnection();
        RecordingContext.connection = connection;
        const db =  RecordingContext.create();
        connection.queueResult({ rowCount: 3 });

        const affected = await db.tasks
            .where(task => task.status.eq('todo'))
            .executeUpdate({ status: 'archived', archived: true });

        expect(affected).toBe(3);
        expect(connection.statements).toEqual([{
            text: 'update "tasks" set "status" = $1, "archived" = $2 where "status" = $3',
            values: ['archived', true, 'todo'],
        }]);
    });

    it('compiles executeDelete() to a single delete statement', async () => {
        const connection = new RecordingDatabaseConnection();
        RecordingContext.connection = connection;
        const db =  RecordingContext.create();
        connection.queueResult({ rowCount: 2 });

        const affected = await db.tasks.where(task => task.status.eq('done')).executeDelete();

        expect(affected).toBe(2);
        expect(connection.statements).toEqual([{
            text: 'delete from "tasks" where "status" = $1',
            values: ['done'],
        }]);
    });

    it('applies tenant filters so a bulk change cannot escape its tenant', async () => {
        const connection = new RecordingDatabaseConnection();
        TenantContext.connection = connection;
        const db =  TenantContext.create();
        connection.queueResult({ rowCount: 1 });

        await db.tasks.where(task => task.status.eq('todo')).executeDelete();

        expect(connection.statements[0].text)
            .toBe('delete from "tasks" where ("status" = $1 and "tenant_id" = $2)');
        expect(connection.statements[0].values).toEqual(['todo', 'tenant_1']);
    });

    it('emits diagnostics for the compiled statement', async () => {
        const connection = new RecordingDatabaseConnection();
        RecordingContext.connection = connection;
        const events: Array<{ operation?: string; phase?: string }> = [];
        class DiagnosticContext extends RecordingContext {
            protected override configure(options: DbContextOptionsBuilder): void {
                super.configure(options);
                options.useDiagnostics(event => {
                    if (event.kind === 'queryPlan') {
                        events.push({ operation: event.shape.operation, phase: event.phase });
                    }
                });
            }
        }
        const db =  DiagnosticContext.create();
        connection.queueResult({ rowCount: 1 });

        await db.tasks.where(task => task.status.eq('todo')).executeDelete();

        expect(events).toEqual([
            { operation: 'executeDelete', phase: 'compile' },
            { operation: 'executeDelete', phase: 'execute' },
        ]);
    });
});

describe('set-based mutation guards', () => {
    let db: RecordingContext;

    beforeEach(() => {
        RecordingContext.connection = new RecordingDatabaseConnection();
        db =  RecordingContext.create();
    });

    it('requires an explicit where(...) filter', async () => {
    // `whereIf(false, ...)` is the realistic way to end up with no predicate:
    // a conditional filter that did not apply. Without the guard this would
    // rewrite or empty the whole table.
        await expect(db.tasks.whereIf(false, task => task.status.eq('todo')).executeDelete())
            .rejects.toBeInstanceOf(QueryCompilationError);
        await expect(db.tasks.whereIf(false, task => task.status.eq('todo')).executeUpdate({ status: 'x' }))
            .rejects.toThrow('executeUpdate() requires a where(...) filter');
    });

    it('does not let a tenant filter stand in for the caller\'s own filter', async () => {
        TenantContext.connection = new RecordingDatabaseConnection();
        const tenantDb =  TenantContext.create();

        await expect(tenantDb.tasks.whereIf(false, task => task.status.eq('todo')).executeDelete())
            .rejects.toThrow('requires a where(...) filter');
    });

    it('rejects a set-based tenant transfer before sending SQL', async () => {
        TenantContext.connection = new RecordingDatabaseConnection();
        const tenantDb = TenantContext.create();

        await expect(tenantDb.tasks.where(task => task.id.eq('task-1'))
            .executeUpdate({ tenantId: 'tenant_2' }))
            .rejects.toBeInstanceOf(TenantOwnershipError);
        expect(TenantContext.connection.statements).toEqual([]);
    });

    it('rejects clauses that only shape a result set', async () => {
        await expect(db.tasks
            .where(task => task.status.eq('todo'))
            .orderBy(task => task.title)
            .executeDelete()).rejects.toThrow('does not support orderBy()');

        await expect(db.tasks
            .where(task => task.status.eq('todo'))
            .take(10)
            .executeDelete()).rejects.toThrow('does not support take()');

        await expect(db.tasks
            .where(task => task.status.eq('todo'))
            .skip(5)
            .executeUpdate({ status: 'x' })).rejects.toThrow('does not support skip()');
    });

    it('refuses to update the primary key or an empty value set', async () => {
        await expect(db.tasks
            .where(task => task.status.eq('todo'))
            .executeUpdate({ id: 'new' })).rejects.toThrow('cannot update primary key property \'Task.id\'');

        await expect(db.tasks
            .where(task => task.status.eq('todo'))
            .executeUpdate({})).rejects.toThrow('must set at least one property');
    });
});

describe('set-based mutations against SQLite', () => {
    let db: SqliteContext;

    beforeEach(async () => {
        db = SqliteContext.create();
        await db.database.connection.query({ text: db.database.createScript(), values: [] });

        for (const [id, status] of [['t1', 'todo'], ['t2', 'todo'], ['t3', 'done']]) {
            db.tasks.add(new Task({ id: id, title: `Task ${id}`, status: status, tenantId: 'tenant_1', archived: false }));
        }
        await db.saveChanges();
        db.changeTracker.clear();
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('updates every matching row in one statement', async () => {
        const affected = await db.tasks
            .where(task => task.status.eq('todo'))
            .executeUpdate({ status: 'archived', archived: true });

        expect(affected).toBe(2);

        const archived = await db.tasks.where(task => task.status.eq('archived')).toArray();
        expect(archived.map(task => task.id).sort()).toEqual(['t1', 't2']);
        // The mapped boolean round-trips through the same value reader.
        expect(archived.every(task => task.archived)).toBe(true);
    });

    it('deletes every matching row in one statement', async () => {
        const affected = await db.tasks.where(task => task.status.eq('todo')).executeDelete();

        expect(affected).toBe(2);
        expect(await db.tasks.count()).toBe(1);
    });

    it('leaves rows that do not match untouched', async () => {
        await db.tasks.where(task => task.status.eq('nothing-matches')).executeDelete();

        expect(await db.tasks.count()).toBe(3);
    });

    it('does not refresh entities this context already tracks', async () => {
        const tracked = await db.tasks.find('t1');
        expect(requireDefined(tracked).status).toBe('todo');

        await db.tasks.where(task => task.status.eq('todo')).executeUpdate({ status: 'archived' });

        // Documented behavior: the statement runs in the database, so a tracked
        // entity keeps its old values until it is reloaded.
        expect(requireDefined(tracked).status).toBe('todo');
        expect(db.changeTracker.entry(requireDefined(tracked))?.state).toBe(EntityState.Unchanged);

        db.changeTracker.clear();
        const reloaded = await db.tasks.find('t1');
        expect(requireDefined(reloaded).status).toBe('archived');
    });
});
