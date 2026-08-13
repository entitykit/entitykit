import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class PendingParent {
    public id = '';
    public children: PendingChild[] = [];
}

class PendingChild {
    public id = '';
    public parentId = '';
    public parent: PendingParent | null = null;
}

class PendingIncludeContext extends DbContext {
    public parents = this.set(PendingParent);
    public children = this.set(PendingChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(PendingParent, entity => {
            entity.toTable('pending_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(PendingChild, entity => {
            entity.toTable('pending_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(PendingParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

async function open(): Promise<PendingIncludeContext> {
    const db = PendingIncludeContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into pending_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into pending_children (id, parent_id) values (?, ?)',
        values: ['c1', 'p1'],
    });
    return db;
}

describe('tracking includes preserve pending relationship intent', () => {
    it('preserves a pending reference assignment', async () => {
        const db = await open();
        const next = requireDefined(await db.parents.find('p2'));
        const child = requireDefined(await db.children.find('c1'));
        child.parent = next;

        const queried = await db.children.include(row => row.parent)
            .where(row => row.id.eq('c1')).single();

        expect(queried).toBe(child);
        expect(child.parent).toBe(next);
        db.changeTracker.detectChanges();
        expect(child.parentId).toBe('p2');
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
        await db.dispose();
    });

    it('preserves a pending scalar foreign-key assignment', async () => {
        const db = await open();
        const child = await db.children.include(row => row.parent).single();
        const original = child.parent;
        const next = requireDefined(await db.parents.find('p2'));
        child.parentId = 'p2';

        await db.children.include(row => row.parent).single();

        expect(child.parentId).toBe('p2');
        expect(child.parent).toBe(original);
        db.changeTracker.detectChanges();
        expect(child.parent).toBe(next);
        await db.dispose();
    });

    it('preserves a pending collection removal', async () => {
        const db = await open();
        const parent = await db.parents.include(row => row.children)
            .where(row => row.id.eq('p1')).single();
        const child = requireDefined(parent.children[0]);
        parent.children = [];

        await db.parents.include(row => row.children)
            .where(row => row.id.eq('p1')).single();

        expect(parent.children).toEqual([]);
        db.changeTracker.detectChanges();
        expect(db.entry(child)?.state).toBe(EntityState.Deleted);
        await db.dispose();
    });

    it('preserves a pending collection addition', async () => {
        const db = await open();
        const parent = await db.parents.include(row => row.children)
            .where(row => row.id.eq('p1')).single();
        const added = Object.assign(new PendingChild(), {
            id: 'c2', parentId: 'p2', parent: null,
        });
        db.children.attach(added);
        parent.children.push(added);

        await db.parents.include(row => row.children)
            .where(row => row.id.eq('p1')).single();

        expect(parent.children).toContain(added);
        db.changeTracker.detectChanges();
        expect(added.parent).toBe(parent);
        expect(added.parentId).toBe('p1');
        await db.dispose();
    });

    it('preserves pending intent through a nested include', async () => {
        const db = await open();
        const next = requireDefined(await db.parents.find('p2'));
        const child = requireDefined(await db.children.find('c1'));
        child.parent = next;

        await db.children.include(row => row.parent)
            .thenInclude(parent => parent.children).single();

        expect(child.parent).toBe(next);
        db.changeTracker.detectChanges();
        expect(child.parentId).toBe('p2');
        await db.dispose();
    });

    it('preserves pending intent through a filtered include', async () => {
        const db = await open();
        const parent = await db.parents.include(row => row.children)
            .where(row => row.id.eq('p1')).single();
        const child = requireDefined(parent.children[0]);
        parent.children = [];

        await db.parents.include(row =>
            row.children.where(item => item.id.eq('c1')))
            .where(row => row.id.eq('p1')).single();

        expect(parent.children).toEqual([]);
        db.changeTracker.detectChanges();
        expect(db.entry(child)?.state).toBe(EntityState.Deleted);
        await db.dispose();
    });

    it('keeps explicit reference loading as an overwrite operation', async () => {
        const db = await open();
        const next = requireDefined(await db.parents.find('p2'));
        const child = requireDefined(await db.children.find('c1'));
        child.parent = next;

        const loaded = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(requireDefined(loaded).id).toBe('p1');
        expect(child.parent.id).toBe('p1');
        await db.dispose();
    });
});
