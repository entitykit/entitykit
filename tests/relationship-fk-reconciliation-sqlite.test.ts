import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState, lazy } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class ReconcileParent {
    public id = '';
    public children: ReconcileChild[] = [];
}

class ReconcileChild {
    public id = '';
    public parentId = '';
    public parent: ReconcileParent | null = null;
}

class ReconcileContext extends DbContext {
    public parents = this.set(ReconcileParent);
    public children = this.set(ReconcileChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useLazyLoading({ maxPerContext: 10 });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ReconcileParent, entity => {
            entity.toTable('reconcile_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(ReconcileChild, entity => {
            entity.toTable('reconcile_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(ReconcileParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function openContext(): Promise<ReconcileContext> {
    const db = ReconcileContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into reconcile_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: `insert into reconcile_children (id, parent_id)
            values (?, ?)`,
        values: ['c', 'p1'],
    });
    return db;
}

describe('reference FK reconciliation', () => {
    it('reconstructs a tracked relationship after an FK change is reverted', async () => {
        const db = await openContext();
        const child = requireDefined(await db.children.find('c'));
        const original = requireDefined(await requireDefined(db.entry(child))
            .reference(row => row.parent).load());

        child.parentId = 'p2';
        db.changeTracker.detectChanges();
        expect(child.parent).toBeNull();
        expect(db.entry(child)?.isNavigationLoaded('parent')).toBe(false);

        child.parentId = 'p1';
        db.changeTracker.detectChanges();

        expect(child.parent).toBe(original);
        expect(original.children).toEqual([child]);
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        expect(db.entry(child)?.modifiedProperties()).toEqual([]);
        expect(db.getSavePlan()).toEqual([]);
        await db.dispose();
    });

    it('invalidates and reloads a lazy reference after detection', async () => {
        const db = await openContext();
        const child = requireDefined(await db.children.find('c'));
        expect((await lazy(child).parent).id).toBe('p1');

        child.parentId = 'p2';
        db.changeTracker.detectChanges();

        expect(child.parent).toBeNull();
        expect(db.entry(child)?.isNavigationLoaded('parent')).toBe(false);
        expect((await lazy(child).parent).id).toBe('p2');
        expect(child.parent?.id).toBe('p2');
        expect(db.entry(child)?.isNavigationLoaded('parent')).toBe(true);
        await db.dispose();
    });

    it('does not return a stale lazy reference before explicit detection', async () => {
        const db = await openContext();
        const child = requireDefined(await db.children.find('c'));
        expect((await lazy(child).parent).id).toBe('p1');

        child.parentId = 'p2';
        const current = await lazy(child).parent;

        expect(current.id).toBe('p2');
        expect(child.parent).toBe(current);
        expect(child.parentId).toBe('p2');
        await db.dispose();
    });
});
