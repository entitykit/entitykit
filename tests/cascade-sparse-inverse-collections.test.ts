import {
    DbContext, DeleteBehavior, EntityState, type DbContextOptionsBuilder, type ModelBuilder,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class SparseParent {
    public id = 0;
    public children: SparseChild[] = [];
}
class SparseChild {
    public id = 0;
    public parentId: number | null = null;
    public parent: SparseParent | null = null;
}
class SparseContext extends DbContext {
    public parents = this.set(SparseParent);
    public children = this.set(SparseChild);
    protected get behavior(): DeleteBehavior {
        return DeleteBehavior.Cascade;
    }
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(SparseParent, entity => {
            entity.toTable('sparse_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(SparseChild, entity => {
            entity.toTable('sparse_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer');
            entity.hasOne(SparseParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => row.parentId).onDelete(this.behavior);
        });
    }
}
class SparseNullContext extends SparseContext {
    protected override get behavior(): DeleteBehavior {
        return DeleteBehavior.SetNull;
    }
}

const behaviors = [
    { name: 'Cascade', context: SparseContext, cascade: true },
    { name: 'SetNull', context: SparseNullContext, cascade: false },
];
const layouts = [
    { name: 'trailing hole', hole: 2, undefinedSlot: false },
    { name: 'interior hole', hole: 1, undefinedSlot: false },
    { name: 'explicit undefined', hole: undefined, undefinedSlot: true },
    { name: 'hole and explicit undefined', hole: 3, undefinedSlot: true },
];

describe.each(behaviors)('$name sparse inverse collections', ({ context, cascade }) => {
    it.each(layouts)('preserves filter semantics for $name', async ({ hole, undefinedSlot }) => {
        const db = context.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({ text: 'insert into sparse_parents values (1)', values: [] });
            await db.database.connection.query({ text: 'insert into sparse_children values (1, 1), (2, 1)', values: [] });
            const parent = await db.parents.include(row => row.children).single();
            const children = [...parent.children];
            expect(children).toHaveLength(2);
            const collection: Array<SparseChild | undefined> = undefinedSlot
                ? [children[0], undefined, children[1]] : [...children];
            if (hole !== undefined) {
                collection.length += 1;
                if (hole === 1) collection[2] = collection[1];
                Reflect.deleteProperty(collection, String(hole));
                expect(Object.hasOwn(collection, hole)).toBe(false);
            }
            if (undefinedSlot) expect(Object.hasOwn(collection, 1)).toBe(true);
            // JavaScript callers can supply an explicit undefined value; unlike
            // an absent slot, Array.prototype.filter retains it during removal.
            parent.children = collection as SparseChild[];

            db.parents.remove(parent);
            await expect(db.saveChanges()).resolves.toBe(3);
            expect(children.map(child => child.parent)).toStrictEqual([null, null]);
            expect(children.map(child => child.parentId)).toStrictEqual(cascade ? [1, 1] : [null, null]);
            for (const child of children) {
                if (cascade) expect(db.entry(child)).toBeUndefined();
                else expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
            }
            expect(db.entry(parent)).toBeUndefined();
            expect(await db.parents.asNoTracking().toArray()).toStrictEqual([]);
            const stored = await db.children.orderBy(row => row.id).asNoTracking().toArray();
            expect(stored.map(row => ({ id: row.id, parentId: row.parentId }))).toStrictEqual(cascade ? [] : [
                { id: 1, parentId: null }, { id: 2, parentId: null },
            ]);
            await expect(db.saveChanges()).resolves.toBe(0);
            expect(parent.children).toHaveLength(undefinedSlot ? 1 : 0);
            expect(parent.children).toStrictEqual(undefinedSlot ? [undefined] : []);
            if (undefinedSlot) expect(Object.hasOwn(parent.children, 0)).toBe(true);
        } finally {
            await db.dispose();
        }
    });
});

describe.each(behaviors)('$name unloaded inverse collections', ({ context, cascade }) => {
    it.each(['missing', 'null'] as const)('saves tracked dependents alongside a %s unloaded inverse collection', async kind => {
        const db = context.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({ text: 'insert into sparse_parents values (1), (2)', values: [] });
            await db.database.connection.query({ text: 'insert into sparse_children values (1, 1), (2, 1)', values: [] });
            const [parent, unloaded] = await db.parents.orderBy(row => row.id).toArray();
            const children = await db.children.orderBy(row => row.id).toArray();
            expect(children).toHaveLength(2);
            expect(db.entry(unloaded)?.isNavigationLoaded('children')).toBe(false);
            if (kind === 'missing') Reflect.deleteProperty(unloaded, 'children');
            else unloaded.children = null as unknown as SparseChild[];

            db.parents.remove(parent);
            await expect(db.saveChanges()).resolves.toBe(3);
            expect(unloaded.children).toBe(kind === 'missing' ? undefined : null);
            expect(parent.children).toStrictEqual([]);
            expect(children.map(child => child.parent)).toStrictEqual([null, null]);
            expect(children.map(child => child.parentId)).toStrictEqual(cascade ? [1, 1] : [null, null]);
            for (const child of children) {
                if (cascade) expect(db.entry(child)).toBeUndefined();
                else expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
            }
            expect(db.entry(parent)).toBeUndefined();
            expect(db.entry(unloaded)?.state).toBe(EntityState.Unchanged);
            expect((await db.parents.asNoTracking().toArray()).map(row => row.id)).toStrictEqual([2]);
            const stored = await db.children.orderBy(row => row.id).asNoTracking().toArray();
            expect(stored.map(row => ({ id: row.id, parentId: row.parentId }))).toStrictEqual(cascade ? [] : [
                { id: 1, parentId: null }, { id: 2, parentId: null },
            ]);
            await expect(db.saveChanges()).resolves.toBe(0);
        } finally {
            await db.dispose();
        }
    });
});
