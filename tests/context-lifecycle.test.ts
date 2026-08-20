import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import {
    ContextConcurrentOperationError,
    ContextDisposedError,
    DbContext,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

/**
 * The lifecycle mistakes a team makes by accident: disposing twice, disposing
 * from a `finally` that also runs inside a transaction, reusing a context after
 * it is gone, or firing two saves at once. Each used to surface as a driver
 * error about a closed pool, a constraint violation blaming the data, or — in
 * one case — a deadlock that presented as a hang.
 */
class Row {
    public id!: string;
    public label!: string;

    constructor(data?: Partial<Row>) {
        Object.assign(this, data);
    }
}

class LifecycleDbContext extends DbContext {
    public rows = this.set(Row);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Row, entity => {
            entity.toTable('rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnName('label').hasColumnType('text').isRequired();
        });
    }
}

async function open(): Promise<LifecycleDbContext> {
    const db =  LifecycleDbContext.create();
    await db.database.connection.query({ text: 'create table rows (id text primary key, label text not null)', values: [] });
    return db;
}

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows) {
        values.push(row);
    }
    return values;
}

describe('context lifecycle', () => {
    it('disposes idempotently', async () => {
    // Disposal is usually written in a `finally`, so a path that also disposes
    // explicitly would otherwise throw a second error over the top of the one
    // it was cleaning up after.
        const db = await open();
        await db.dispose();
        await expect(db.dispose()).resolves.toBeUndefined();
    });

    it('supports asynchronous explicit resource management', async () => {
        const db = await open();

        await db[Symbol.asyncDispose]();

        await expect(db.rows.toArray()).rejects.toBeInstanceOf(
            ContextDisposedError,
        );
    });

    it('names the context, not the connection, when reused after disposal', async () => {
        const db = await open();
        await db.dispose();

        await expect(db.rows.toArray()).rejects.toMatchObject({
            code: 'CONTEXT_DISPOSED',
            name: ContextDisposedError.name,
        });
    });

    it('rejects a deferred entity stream after owned connection disposal', async () => {
        const db = await open();
        const stream = db.rows.stream();

        await db.dispose();

        await expect(collect(stream)).rejects.toBeInstanceOf(
            ContextDisposedError,
        );
    });

    it('rejects a deferred projection stream after owned connection disposal', async () => {
        const db = await open();
        const stream = db.rows
            .select(row => ({ label: row.label }))
            .stream();

        await db.dispose();

        await expect(collect(stream)).rejects.toBeInstanceOf(
            ContextDisposedError,
        );
    });

    it('rejects a deferred aggregate stream after owned connection disposal', async () => {
        const db = await open();
        const stream = db.rows.aggregate(aggregate => ({
            total: aggregate.count(),
        })).stream();

        await db.dispose();

        await expect(collect(stream)).rejects.toBeInstanceOf(
            ContextDisposedError,
        );
    });

    it('refuses to return a tracked find result after disposal', async () => {
        const db = await open();
        const row = new Row({ id: 'tracked', label: 'tracked' });
        db.rows.attach(row);
        await db.dispose();

        await expect(db.rows.find('tracked')).rejects.toBeInstanceOf(
            ContextDisposedError,
        );
    });

    it('refuses a raw entity query created before disposal', async () => {
        const db = await open();
        const query = db.rows.fromSqlUnsafe`select id, label from rows`;
        await db.dispose();

        await expect(query.toArray()).rejects.toBeInstanceOf(
            ContextDisposedError,
        );
    });

    it('refuses a save on a disposed context', async () => {
        const db = await open();
        await db.dispose();
        db.rows.add(new Row({ id: 'a', label: 'a' }));

        await expect(db.saveChanges()).rejects.toThrow(/DbContext was disposed, so saveChanges\(\) cannot run/);
    });

    it('refuses a transaction on a disposed context', async () => {
        const db = await open();
        await db.dispose();

        await expect(db.transaction(() => undefined)).rejects.toThrow(/DbContext was disposed, so transaction\(\) cannot run/);
    });

    it('refuses disposal from inside an open transaction instead of deadlocking', async () => {
    // Closing the connection waits for the in-flight transaction's client to be
    // released, and that client is waiting for the dispose call to return.
    // Measured before the fix against live Postgres: no error, no timeout, the
    // transaction simply never returned.
        const db = await open();

        await expect(db.transaction(async () => {
            db.rows.add(new Row({ id: 't1', label: 'one' }));
            await db.saveChanges();
            await db.dispose();
        })).rejects.toMatchObject({
            code: 'CONTEXT_CONCURRENT_OPERATION',
            name: ContextConcurrentOperationError.name,
        });

        // The failed transaction still rolled back, and the context is still usable.
        db.changeTracker.clear();
        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });

    it('refuses disposal from a direct database operation and remains usable', async () => {
        const db = await open();

        await expect(db.database.connection.session?.(async () => {
            await db.dispose();
        })).rejects.toThrow(/cannot be disposed while a database operation is active/);

        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });

    it('refuses a second concurrent save rather than blaming the data', async () => {
    // A context is a unit of work, not a connection pool: overlapping saves
    // share one change tracker, so the second builds its plan from entities the
    // first has not finished persisting. That used to surface as a unique
    // constraint violation, which points at the database instead of the misuse.
        const db = await open();
        db.rows.add(new Row({ id: 'c1', label: 'one' }));
        db.rows.add(new Row({ id: 'c2', label: 'two' }));

        const [first, second] = await Promise.allSettled([db.saveChanges(), db.saveChanges()]);

        expect(first.status).toBe('fulfilled');
        expect(second.status).toBe('rejected');
        if (second.status === 'rejected') {
            const reason: unknown = second.reason;
            expect(reason).toBeInstanceOf(ContextConcurrentOperationError);
            const message = reason instanceof Error ? reason.message : String(reason);
            expect(message).toMatch(/saveChanges\(\) is already in progress/);
        }

        // The first save still committed exactly its own plan.
        expect(await db.rows.count()).toBe(2);
        await db.dispose();
    });

    it('allows sequential saves on the same context', async () => {
        const db = await open();

        db.rows.add(new Row({ id: 's1', label: 'one' }));
        expect(await db.saveChanges()).toBe(1);
        db.rows.add(new Row({ id: 's2', label: 'two' }));
        expect(await db.saveChanges()).toBe(1);

        // The in-progress flag must clear after a *failed* save too, or one
        // constraint violation would wedge the context permanently. The tracker is
        // cleared first because the identity map refuses a duplicate key before it
        // ever reaches the database.
        db.changeTracker.clear();
        db.rows.add(new Row({ id: 's1', label: 'duplicate' }));
        await expect(db.saveChanges()).rejects.toThrow();
        db.changeTracker.clear();

        db.rows.add(new Row({ id: 's3', label: 'three' }));
        expect(await db.saveChanges()).toBe(1);
        await db.dispose();
    });
});
