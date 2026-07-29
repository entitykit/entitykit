import { seedJoinData } from './seed-data';
import type { ProviderContractTestContext } from './test-context';

export function defineJoinProviderContractTests(context: ProviderContractTestContext): void {
    it('joins a child to its parent the same way on every provider', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareJoinData) {
            return;
        }
        await runtime.prepareJoinData(db);
        await seedJoinData(db);

        const rows = await db.children
            .join('parent', db.parents, ({ root, parent }) => root.parentId.eq(parent.id))
            .orderBy(({ root }) => root.id)
            .select(({ root, parent }) => ({ child: root.id, parent: parent.name, score: root.score }))
            .toArray();

        expect(rows).toEqual([
            { child: 'c1', parent: 'Ana', score: 10 },
            { child: 'c2', parent: 'Ana', score: 20 },
            { child: 'c3', parent: 'Bo', score: 30 },
        ]);
    });

    it('keeps unmatched rows through a left join the same way', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareJoinData) {
            return;
        }
        await runtime.prepareJoinData(db);
        await seedJoinData(db);

        // Cy has no children; a left join must still return it.
        const rows = await db.parents
            .leftJoin('child', db.children, ({ root, child }) => root.id.eq(child.parentId))
            .select(({ root }) => ({ parent: root.name }))
            .toArray();

        expect([...new Set(rows.map(row => row.parent))].sort()).toEqual(['Ana', 'Bo', 'Cy']);
    });

    it('groups a joined column and sums per group the same way', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareJoinData) {
            return;
        }
        await runtime.prepareJoinData(db);
        await seedJoinData(db);

        const rows = await db.children
            .join('parent', db.parents, ({ root, parent }) => root.parentId.eq(parent.id))
            .groupBy(({ parent }) => ({ name: parent.name }))
            .orderBy(group => group.key.name)
            .select(group => ({ name: group.key.name, total: group.sum(({ root }) => root.score) }))
            .toArray();

        expect(rows.map(row => [row.name, Number(row.total)])).toEqual([['Ana', 30], ['Bo', 30]]);
    });

    it('filters on the joined side the same way', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareJoinData) {
            return;
        }
        await runtime.prepareJoinData(db);
        await seedJoinData(db);

        const rows = await db.children
            .join('parent', db.parents, ({ root, parent }) => root.parentId.eq(parent.id))
            .where(({ parent }) => parent.name.eq('Ana'))
            .select(({ root }) => ({ child: root.id }))
            .toArray();

        expect(rows.map(row => row.child).sort()).toEqual(['c1', 'c2']);
    });
}
