import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class EagerParent {
    public id = 0;
    public children: EagerChild[] = [];
}

class EagerChild {
    public id = '';
    public parentId = 0;
    public parent?: EagerParent;
    public leaves: EagerLeaf[] = [];
}

class EagerLeaf {
    public id = '';
    public childId = '';
    public child?: EagerChild;
}

class EagerSnapshotContext extends DbContext {
    public parents = this.set(EagerParent);
    public children = this.set(EagerChild);
    public leaves = this.set(EagerLeaf);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(EagerParent, entity => {
            entity.toTable('eager_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(EagerChild, entity => {
            entity.toTable('eager_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(EagerParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(EagerLeaf, entity => {
            entity.toTable('eager_leaves');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.childId).hasColumnName('child_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(EagerChild, row => row.child)
                .withMany(child => child.leaves)
                .hasForeignKey(row => row.childId);
        });
    }
}

async function open(): Promise<EagerSnapshotContext> {
    const db = EagerSnapshotContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    for (const statement of [
        {
            text: 'insert into eager_parents (id) values (?), (?)',
            values: [1, 2],
        },
        {
            text: `insert into eager_children (id, parent_id)
                values (?, ?), (?, ?)`,
            values: ['child-1', 1, 'child-2', 2],
        },
        {
            text: `insert into eager_leaves (id, child_id)
                values (?, ?), (?, ?)`,
            values: ['leaf-1', 'child-1', 'leaf-2', 'child-2'],
        },
    ]) {
        await db.database.connection.query(statement);
    }
    return db;
}

describe('eager include row snapshots', () => {
    it('loads children from the root row instead of a substituted entity', async () => {
        const db = await open();
        const tracked = requireDefined(await db.parents.find(1));
        tracked.id = 2;

        const queried = await db.parents.where(row => row.id.eq(1))
            .include(row => row.children)
            .single();

        expect(queried).toBe(tracked);
        expect(queried.id).toBe(2);
        expect(queried.children.map(child => child.id)).toEqual(['child-1']);
        tracked.id = 1;
        expect(db.getSavePlan()).toEqual([]);
        await db.dispose();
    });

    it('loads nested children from each related database row', async () => {
        const db = await open();
        const trackedChild = requireDefined(await db.children.find('child-1'));
        trackedChild.id = 'child-2';

        const parent = await db.parents.where(row => row.id.eq(1))
            .include(row => row.children)
            .thenInclude(child => child.leaves)
            .single();

        expect(parent.children).toEqual([trackedChild]);
        expect(trackedChild.id).toBe('child-2');
        expect(trackedChild.leaves.map(leaf => leaf.id)).toEqual(['leaf-1']);
        trackedChild.id = 'child-1';
        expect(db.getSavePlan()).toEqual([]);
        await db.dispose();
    });
});
