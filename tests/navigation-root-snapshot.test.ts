import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class ChangingNumber {
    private stable = 0;
    private reads: number[] = [];

    public get value(): number {
        return this.reads.shift() ?? this.stable;
    }

    public set value(value: number) {
        this.stable = value;
        this.reads = [];
    }

    public returnInOrder(...values: number[]): void {
        this.reads = [...values];
    }
}

class SnapshotParent {
    private readonly identity = new ChangingNumber();
    public name = '';
    public children: SnapshotChild[] = [];
    public tags: SnapshotTag[] = [];

    public get id(): number {
        return this.identity.value;
    }

    public set id(value: number) {
        this.identity.value = value;
    }

    public changeIdReads(...values: number[]): void {
        this.identity.returnInOrder(...values);
    }
}

class SnapshotChild {
    private readonly foreignKey = new ChangingNumber();
    public id = '';
    public parent?: SnapshotParent;

    public get parentId(): number {
        return this.foreignKey.value;
    }

    public set parentId(value: number) {
        this.foreignKey.value = value;
    }

    public changeParentReads(...values: number[]): void {
        this.foreignKey.returnInOrder(...values);
    }
}

class SnapshotTag {
    public id = '';
    public parents: SnapshotParent[] = [];
}

class NavigationSnapshotContext extends DbContext {
    public parents = this.set(SnapshotParent);
    public children = this.set(SnapshotChild);
    public tags = this.set(SnapshotTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SnapshotParent, entity => {
            entity.toTable('snapshot_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnType('integer').isRequired();
            entity.property(parent => parent.name).hasColumnType('text').isRequired();
            entity.hasManyToMany(SnapshotTag, parent => parent.tags)
                .withMany(tag => tag.parents)
                .usingJoinTable('snapshot_parent_tags', join => {
                    join.sourceForeignKey('parent_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(SnapshotChild, entity => {
            entity.toTable('snapshot_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(SnapshotParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => child.parentId);
        });
        model.entity(SnapshotTag, entity => {
            entity.toTable('snapshot_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('text').isRequired();
        });
    }
}

async function open(): Promise<NavigationSnapshotContext> {
    const db = NavigationSnapshotContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    for (const statement of [
        {
            text: `insert into snapshot_parents (id, name)
                values (?, ?), (?, ?)`,
            values: [1, 'one', 2, 'two'],
        },
        {
            text: `insert into snapshot_children (id, parent_id)
                values (?, ?), (?, ?)`,
            values: ['child-1', 1, 'child-2', 2],
        },
        {
            text: 'insert into snapshot_tags (id) values (?), (?)',
            values: ['tag-1', 'tag-2'],
        },
        {
            text: `insert into snapshot_parent_tags (parent_id, tag_id)
                values (?, ?), (?, ?)`,
            values: [1, 'tag-1', 2, 'tag-2'],
        },
    ]) {
        await db.database.connection.query(statement);
    }
    return db;
}

describe('navigation root snapshots', () => {
    it('uses one persisted principal key for a collection load', async () => {
        const db = await open();
        const parent = requireDefined(await db.parents.find(1));
        parent.changeIdReads(1, 2, 2);

        const children = await requireDefined(db.entry(parent))
            .collection(row => row.children).load();

        expect(children.map(child => child.id)).toEqual(['child-1']);
        await db.dispose();
    });

    it('uses one current foreign key for a reference load', async () => {
        const db = await open();
        const child = requireDefined(await db.children.find('child-1'));
        child.changeParentReads(1, 2, 2);

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.name).toBe('one');
        await db.dispose();
    });

    it('uses one persisted key for a many-to-many load', async () => {
        const db = await open();
        const parent = requireDefined(await db.parents.find(1));
        parent.changeIdReads(1, 2, 2);

        const tags = await requireDefined(db.entry(parent))
            .collection(row => row.tags).load();

        expect(tags.map(tag => tag.id)).toEqual(['tag-1']);
        await db.dispose();
    });
});
