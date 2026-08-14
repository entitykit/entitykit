import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import type { EntityEntry } from '../src/tracking/entity-entry';
import { activeTemporaryGeneratedIdentity } from '../src/tracking/temporary-generated-identity';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { internalEntityEntry } from './support/public-api-internals';

class SqliteTransactionParent {
    public id = 0;
    public name = '';
    public children: SqliteTransactionChild[] = [];
}

class SqliteTransactionChild {
    public id = '';
    public parentId = 0;
    public parent: SqliteTransactionParent | null = null;
}

class GeneratedRelationshipSqliteContext extends DbContext {
    public parents = this.set(SqliteTransactionParent);
    public children = this.set(SqliteTransactionChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SqliteTransactionParent, entity => {
            entity.toTable('transaction_sqlite_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(SqliteTransactionChild, entity => {
            entity.toTable('transaction_sqlite_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(SqliteTransactionParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function open(): Promise<GeneratedRelationshipSqliteContext> {
    const db = GeneratedRelationshipSqliteContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into transaction_sqlite_parents (id, name)
            values (?, ?)`,
        values: [2, 'existing'],
    });
    await db.database.connection.query({
        text: `insert into transaction_sqlite_children (id, parent_id)
            values (?, ?)`,
        values: ['existing-child', 2],
    });
    return db;
}

async function storedParentId(
    db: GeneratedRelationshipSqliteContext,
    childId = 'existing-child',
): Promise<number> {
    const result = await db.database.connection.query<{ parent_id: number }>({
        text: `select parent_id from transaction_sqlite_children
            where id = ?`,
        values: [childId],
    });
    return result.rows[0]?.parent_id ?? -1;
}

describe('generated relationship transactions on SQLite', () => {
    it('updates an existing child on the second save and commits', async () => {
        const db = await open();
        const child = await db.children.find('existing-child');
        if (!child) throw new Error('Expected existing child.');
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'generated',
        });

        await db.transaction(async tx => {
            tx.parents.add(parent);
            await expect(tx.saveChanges()).resolves.toBe(1);
            expect(parent.id).toBe(3);
            child.parent = parent;
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(await storedParentId(db)).toBe(3);
        expect(child.parentId).toBe(3);
        await db.dispose();
    });

    it('inserts an FK-only child after the generated principal save', async () => {
        const db = await open();
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'generated',
        });
        const child = Object.assign(new SqliteTransactionChild(), {
            id: 'later-child',
        });

        await db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            child.parentId = parent.id;
            tx.children.add(child);
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(parent.id).toBe(3);
        expect(child.parent).toBe(parent);
        await db.dispose();
    });

    it('restores temporary identity and database rows on rollback', async () => {
        const db = await open();
        const child = await db.children.find('existing-child');
        if (!child) throw new Error('Expected existing child.');
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'generated',
        });

        await expect(db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            child.parent = parent;
            await tx.saveChanges();
            throw new Error('abort outer');
        })).rejects.toThrow('abort outer');

        expect(await storedParentId(db)).toBe(2);
        await expect(db.parents.count()).resolves.toBe(1);
        expect(parent.id).toBe(0);
        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        expect(child.parentId).toBe(2);
        expect(db.entry(child)?.originalValues.parentId).toBe(2);
        const parentEntry = db.entry(parent);
        if (!parentEntry) throw new Error('Expected tracked parent.');
        const tracked = internalEntityEntry(parentEntry) as unknown as
            EntityEntry<object>;
        expect(activeTemporaryGeneratedIdentity(tracked)).toBeDefined();
        await db.dispose();
    });

    it('retargets an FK-only child when a rolled-back ID is reused', async () => {
        const db = await open();
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'retried-generated-parent',
        });
        const child = Object.assign(new SqliteTransactionChild(), {
            id: 'later-child',
        });

        await expect(db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            expect(parent.id).toBe(3);
            child.parentId = parent.id;
            tx.children.add(child);
            await tx.saveChanges();
            throw new Error('abort outer');
        })).rejects.toThrow('abort outer');

        expect(parent.id).toBe(0);
        expect(child).toMatchObject({ parentId: 3, parent: null });
        await db.database.connection.query({
            text: `insert into transaction_sqlite_parents (name)
                values (?)`,
            values: ['unrelated'],
        });
        const retryChild = db.getSavePlan().find(entry =>
            entry.entity === child);
        expect(retryChild?.statement.values).not.toContain(3);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(parent.id).toBe(4);
        expect(child).toMatchObject({ parentId: 4, parent });
        await expect(storedParentId(db, child.id)).resolves.toBe(4);
        await db.dispose();
    });
});
