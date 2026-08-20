import { requireDefined } from '../support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import { postgresProviderServices } from '../../packages/postgres/src';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

class Task {
    public id!: string;
    public title!: string;
    public status!: string;
    public archived!: boolean;

    constructor(data?: Partial<Task>) {
        Object.assign(this, data);
    }
}

class TaskContext extends DbContext {
    public tasks = this.set(Task);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(postgresProviderServices, requireDefined(process.env.DATABASE_URL));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Task, entity => {
            entity.toTable('bulk_tasks');
            entity.hasKey(task => task.id);
            entity.property(task => task.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(task => task.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(task => task.status).hasColumnName('status').hasColumnType('text').isRequired();
            entity.property(task => task.archived).hasColumnName('archived').hasColumnType('boolean').isRequired();
        });
    }
}

describePostgres('set-based mutations against live Postgres', () => {
    let db: TaskContext;

    beforeEach(async () => {
        db = TaskContext.create();
        await db.database.connection.query({ text: 'drop table if exists "bulk_tasks" cascade', values: [] });
        await db.database.connection.query({ text: db.database.createScript(), values: [] });

        for (const [id, status] of [['t1', 'todo'], ['t2', 'todo'], ['t3', 'done']]) {
            db.tasks.add(new Task({ id: id, title: `Task ${id}`, status: status, archived: false }));
        }
        await db.saveChanges();
        db.changeTracker.clear();
    });

    afterEach(async () => {
        await db.database.connection.query({ text: 'drop table if exists "bulk_tasks" cascade', values: [] });
        await db.dispose();
    });

    it('updates every matching row in one statement', async () => {
        const affected = await db.tasks
            .where(task => task.status.eq('todo'))
            .executeUpdate({ status: 'archived', archived: true });

        expect(affected).toBe(2);

        const archived = await db.tasks.where(task => task.status.eq('archived')).toArray();
        expect(archived.map(task => task.id).sort()).toEqual(['t1', 't2']);
        expect(archived.every(task => task.archived)).toBe(true);
    });

    it('deletes every matching row in one statement', async () => {
        const affected = await db.tasks.where(task => task.status.eq('todo')).executeDelete();

        expect(affected).toBe(2);
        expect(await db.tasks.count()).toBe(1);
    });

    it('rolls back with the surrounding transaction', async () => {
        await expect(db.transaction(async () => {
            await db.tasks.where(task => task.status.eq('todo')).executeDelete();
            expect(await db.tasks.count()).toBe(1);
            throw new Error('rollback please');
        })).rejects.toThrow('rollback please');

        // The statement participates in the provider transaction like any other.
        expect(await db.tasks.count()).toBe(3);
    });
});
