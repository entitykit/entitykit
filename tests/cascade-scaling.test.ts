import { DbContext, DeleteBehavior, EntityState, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import * as resolution from '../packages/core/src/tracking/relationship-resolution';
import { sqliteProviderServices } from '../packages/sqlite/src';

class CascadeNode {
    public id = 0; public parentId: number | null = null; public parent: CascadeNode | null = null; public children: CascadeNode[] = [];
}
class CascadeContext extends DbContext {
    public nodes = this.set(CascadeNode);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(CascadeNode, entity => {
            entity.toTable('cascade_nodes'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer');
            entity.hasOne(CascadeNode, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => row.parentId).onDelete(DeleteBehavior.Cascade);
        });
    }
}

describe('tracked cascade scaling', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([100, 200, 400])('resolves %i disjoint parent/child pairs with linear relationship work', async count => {
        const db = CascadeContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({
                text: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?)
                    insert into cascade_nodes select n, case when n % 2 = 0 then n-1 else null end from numbers`,
                values: [2 * count],
            });
            const nodes = await db.nodes.toArray();
            for (const node of nodes.filter(node => node.parentId === null)) db.nodes.remove(node);
            const connects = jest.spyOn(resolution, 'relationshipConnects');
            db.changeTracker.detectChanges();
            expect(connects.mock.calls.length).toBeLessThanOrEqual(8 * count);
            expect(db.changeTracker.entries().every(entry => entry.state === EntityState.Deleted)).toBe(true);
            expect(nodes.every(node => node.parent === null && node.children.length === 0)).toBe(true);
            await expect(db.saveChanges()).resolves.toBe(2 * count);
            expect(await db.nodes.count()).toBe(0);
            expect(db.changeTracker.entries()).toEqual([]);
        } finally {
            await db.dispose();
        }
    });

    it.each([100, 200, 400])('processes a reverse-tracked %i-node cascade chain once', async count => {
        const db = CascadeContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({
                text: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?)
                    insert into cascade_nodes select n, case when n = 1 then null else n-1 end from numbers`,
                values: [count],
            });
            const nodes = await db.nodes.orderByDescending(row => row.id).toArray();
            const root = nodes.find(row => row.id === 1);
            expect(root).toBeDefined();
            if (!root) throw new Error('missing seeded root');
            db.nodes.remove(root);
            const connects = jest.spyOn(resolution, 'relationshipConnects');
            db.changeTracker.detectChanges();
            expect(connects.mock.calls.length).toBeLessThanOrEqual(8 * count);
            expect(db.changeTracker.entries().every(entry => entry.state === EntityState.Deleted)).toBe(true);
            expect(nodes.every(node => node.parent === null && node.children.length === 0)).toBe(true);
            await expect(db.saveChanges()).resolves.toBe(count);
            expect(await db.nodes.count()).toBe(0);
        } finally {
            await db.dispose();
        }
    });
});
