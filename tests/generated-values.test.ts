import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import type { SqlDialect } from '../src/adapter';
import { DbContext, EntityState } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { mySqlDialect } from '../src/providers/mysql/mysql-dialect';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    internalChangeTracker,
    setMetadata,
} from './support/public-api-internals';

class GeneratedItem {
    public id!: number;
    public name!: string;
    public createdAt!: Date;
    public updatedAt!: Date;

    constructor(data?: Partial<GeneratedItem>) {
        Object.assign(this, data);
    }
}

class GeneratedValuesContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static sqlDialect: SqlDialect = postgresDialect;

    public items = this.set(GeneratedItem);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(
            GeneratedValuesContext.connection,
            {
                provider: GeneratedValuesContext.sqlDialect.name,
                dialect: GeneratedValuesContext.sqlDialect,
            },
        );
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedItem, entity => {
            entity.toTable('generated_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id)
                .hasColumnName('id').hasColumnType('integer').isRequired()
                .valueGeneratedOnAdd();
            entity.property(item => item.name)
                .hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(item => item.createdAt)
                .hasColumnName('created_at').hasColumnType('timestamptz').isRequired()
                .hasDefaultSql('current_timestamp')
                .valueGeneratedOnAdd();
            entity.property(item => item.updatedAt)
                .hasColumnName('updated_at').hasColumnType('timestamptz').isRequired()
                .hasDefaultSql('current_timestamp')
                .valueGeneratedOnAddOrUpdate();
        });
    }
}

class GeneratedParent {
    public id!: number;
    public name!: string;
}

class GeneratedChild {
    public id!: string;
    public parentId!: number;
    public parent!: GeneratedParent;
}

class GeneratedGraphContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    public parents = this.set(GeneratedParent);
    public children = this.set(GeneratedChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(
            GeneratedGraphContext.connection,
            { provider: postgresDialect.name, dialect: postgresDialect },
        );
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedParent, entity => {
            entity.toTable('generated_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id)
                .hasColumnName('id').hasColumnType('integer').isRequired()
                .valueGeneratedOnAdd();
            entity.property(parent => parent.name)
                .hasColumnName('name').hasColumnType('text').isRequired();
        });
        model.entity(GeneratedChild, entity => {
            entity.toTable('generated_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(child => child.parentId)
                .hasColumnName('parent_id').hasColumnType('integer').isRequired();
            entity.hasOne(GeneratedParent, child => child.parent)
                .withMany()
                .hasForeignKey(child => child.parentId);
        });
    }
}

function createDb(
    dialect: SqlDialect = postgresDialect,
): {
    readonly db: GeneratedValuesContext;
    readonly connection: RecordingDatabaseConnection;
} {
    const connection = new RecordingDatabaseConnection();
    GeneratedValuesContext.connection = connection;
    GeneratedValuesContext.sqlDialect = dialect;
    return { db: GeneratedValuesContext.create(), connection };
}

describe('database-generated values', () => {
    it('restores generated values and temporary identity after an outer rollback', async () => {
        const { db, connection } = createDb();
        const item = new GeneratedItem({ name: 'generated' });
        db.items.add(item);
        connection.queueResult({
            rows: [{
                id: 41,
                created_at: new Date('2026-07-30T10:00:00.000Z'),
                updated_at: new Date('2026-07-30T10:00:01.000Z'),
            }],
            rowCount: 1,
        });

        await expect(db.transaction(async transaction => {
            await transaction.saveChanges();
            expect(item.id).toBe(41);
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(item.id).toBeUndefined();
        expect(item.createdAt).toBeUndefined();
        expect(item.updatedAt).toBeUndefined();
        expect(db.entry(item)?.state).toBe(EntityState.Added);
        expect(internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.items), 41))
            .toBeUndefined();
        expect(db.getSavePlan()).toHaveLength(1);
    });

    it('omits and hydrates generated-on-add values through returning', async () => {
        const { db, connection } = createDb();
        const createdAt = new Date('2026-07-30T10:00:00.000Z');
        const updatedAt = new Date('2026-07-30T10:00:01.000Z');
        const item = new GeneratedItem({ name: 'generated' });

        db.items.add(item);
        connection.queueResult({
            rows: [{ id: 41, created_at: createdAt, updated_at: updatedAt }],
            rowCount: 1,
        });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements).toEqual([{
            text: 'insert into "generated_items" ("name") values ($1) returning "id", "created_at", "updated_at"',
            values: ['generated'],
        }]);
        expect(item).toMatchObject({ id: 41, createdAt, updatedAt });
        expect(db.entry(item)?.state).toBe(EntityState.Unchanged);
        expect(internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.items), 41)?.entity)
            .toBe(item);
    });

    it('hydrates generated-on-update values', async () => {
        const { db, connection } = createDb();
        const original = new Date('2026-07-30T10:00:00.000Z');
        const refreshed = new Date('2026-07-30T11:00:00.000Z');
        const item = new GeneratedItem({
            id: 7,
            name: 'before',
            createdAt: original,
            updatedAt: original,
        });
        db.items.attach(item);
        item.name = 'after';
        connection.queueResult({
            rows: [{ updated_at: refreshed }],
            rowCount: 1,
        });

        await db.saveChanges();

        expect(connection.statements).toEqual([{
            text: 'update "generated_items" set "name" = $1 where "id" = $2 returning "updated_at"',
            values: ['after', 7],
        }]);
        expect(item.updatedAt).toEqual(refreshed);
        expect(db.entry(item)?.originalValues.updatedAt).toEqual(refreshed);
    });

    it('uses MySQL insertId and refreshes the remaining generated values', async () => {
        const { db, connection } = createDb(mySqlDialect);
        const createdAt = new Date('2026-07-30T10:00:00.000Z');
        const updatedAt = new Date('2026-07-30T10:00:01.000Z');
        const item = new GeneratedItem({ id: 0, name: 'mysql' });
        db.items.add(item);
        connection.queueResult({ rowCount: 1, insertId: 42 });
        connection.queueResult({
            rows: [{ created_at: createdAt, updated_at: updatedAt }],
            rowCount: 1,
        });

        await db.saveChanges();

        expect(connection.statements).toEqual([
            {
                text: 'insert into `generated_items` (`name`) values (?)',
                values: ['mysql'],
            },
            {
                text: 'select `created_at`, `updated_at` from `generated_items` where `id` = ?',
                values: [42],
            },
        ]);
        expect(item).toMatchObject({
            id: 42,
            createdAt,
            updatedAt,
        });
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('restores hydrated values when a later generated insert rolls back', async () => {
        const { db, connection } = createDb();
        const first = new GeneratedItem({ id: 0, name: 'first' });
        const second = new GeneratedItem({ id: 0, name: 'second' });
        db.items.add(first);
        db.items.add(second);
        connection.queueResult({
            rows: [{
                id: 1,
                created_at: new Date(),
                updated_at: new Date(),
            }],
            rowCount: 1,
        });
        connection.queueError(new Error('second insert failed'));

        await expect(db.saveChanges()).rejects.toThrow('second insert failed');

        expect(first.id).toBe(0);
        expect(second.id).toBe(0);
        expect(first.createdAt).toBeUndefined();
        expect(first.updatedAt).toBeUndefined();
        expect(db.entry(first)?.state).toBe(EntityState.Added);
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
    });

    it('propagates a generated principal key through an added graph', async () => {
        const connection = new RecordingDatabaseConnection();
        GeneratedGraphContext.connection = connection;
        const db = GeneratedGraphContext.create();
        const parent = { name: 'parent' } as GeneratedParent;
        const child = { id: 'child-1', parent } as GeneratedChild;
        db.children.add(child);
        db.parents.add(parent);
        connection.queueResult({ rows: [{ id: 71 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(2);
        expect(parent.id).toBe(71);
        expect(child.parentId).toBe(71);
        expect(connection.statements).toEqual([
            {
                text: 'insert into "generated_parents" ("name") values ($1) returning "id"',
                values: ['parent'],
            },
            {
                text: 'insert into "generated_children" ("id", "parent_id") values ($1, $2)',
                values: ['child-1', 71],
            },
        ]);
    });
});
