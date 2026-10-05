import { DbContext, DeleteBehavior, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class HookParent {
    public id = 0;
    public children: HookChild[] = [];
}
class HookChild {
    public id = 0;
    public parentId = 0;
    public parent: HookParent | null = null;
}
class HookContext extends DbContext {
    public parents = this.set(HookParent);
    public children = this.set(HookChild);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(HookParent, entity => {
            entity.toTable('hook_parents'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(HookChild, entity => {
            entity.toTable('hook_children'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer').isRequired();
            entity.hasOne(HookParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => row.parentId).onDelete(DeleteBehavior.Cascade);
        });
    }
}

describe('cascades with dynamic inverse collection values', () => {
    it.each(['proxy', 'own-filter'])('discovers relationships redirected by a %s collection hook', async kind => {
        const db = HookContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({ text: 'insert into hook_parents values (1), (2), (3)', values: [] });
            await db.database.connection.query({ text: 'insert into hook_children values (1, 1), (2, 3)', values: [] });
            const parents = await db.parents.orderBy(row => row.id).include(row => row.children).toArray();
            const first = parents[0].children[0];
            const redirected = parents[2].children[0];
            const original = parents[0].children;
            const nativeFilter = original.filter.bind(original);
            const filter = jest.fn((predicate: (child: HookChild) => boolean) => {
                redirected.parent = parents[1];
                return nativeFilter(predicate);
            });
            if (kind === 'proxy') {
                parents[0].children = new Proxy(original, {
                    get: (target, property, receiver): unknown => property === 'filter'
                        ? filter : Reflect.get(target, property, receiver),
                });
            } else Object.defineProperty(original, 'filter', { value: filter });
            db.parents.remove(parents[0]);
            db.parents.remove(parents[1]);
            await expect(db.saveChanges()).resolves.toBe(4);
            expect(filter).toHaveBeenCalled();
            expect(await db.children.asNoTracking().toArray()).toEqual([]);
            expect(await db.parents.asNoTracking().toArray()).toMatchObject([{ id: 3 }]);
            expect(db.entry(first)).toBeUndefined();
            expect(db.entry(redirected)).toBeUndefined();
            expect(first.parent).toBeNull();
            expect(redirected.parent).toBeNull();
            expect(db.changeTracker.entries().map(entry => entry.entity)).toEqual([parents[2]]);
        } finally {
            await db.dispose();
        }
    });
});
