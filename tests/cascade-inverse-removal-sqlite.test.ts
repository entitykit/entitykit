import {
    DbContext, DeleteBehavior, EntityState, type DbContextOptionsBuilder, type ModelBuilder,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import * as collectionCopy from '../packages/core/src/tracking/navigation-collection-copy';
import { directNavigationWriter } from '../packages/core/src/tracking/navigation-writer';

class RemovalParent {
    public id = 0;
    public children: RemovalChild[] = [];
}
class RemovalChild {
    public id = 0;
    public parentId: number | null = null;
    public parent: RemovalParent | null = null;
}
class RemovalContext extends DbContext {
    public parents = this.set(RemovalParent);
    public children = this.set(RemovalChild);
    protected get behavior(): DeleteBehavior {
        return DeleteBehavior.Cascade;
    }
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(RemovalParent, entity => {
            entity.toTable('removal_parents'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(RemovalChild, entity => {
            entity.toTable('removal_children'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer');
            entity.hasOne(RemovalParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => row.parentId).onDelete(this.behavior);
        });
    }
}
class NullContext extends RemovalContext {
    protected override get behavior(): DeleteBehavior {
        return DeleteBehavior.SetNull;
    }
}
const cases = [
    { name: 'Cascade', context: RemovalContext, cascade: true },
    { name: 'SetNull', context: NullContext, cascade: false },
];

async function populated(context: typeof RemovalContext, count: number): Promise<RemovalContext> {
    const db = context.create();
    await db.database.ensureCreated();
    await db.database.connection.query({ text: 'insert into removal_parents values (1), (2)', values: [] });
    await db.database.connection.query({
        text: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?)
            insert into removal_children select n, case when n = ? then 2 else 1 end from numbers`,
        values: [count + 1, count + 1],
    });
    return db;
}

describe.each(cases)('$name loaded inverse removal', ({ context, cascade }) => {
    afterEach(() => jest.restoreAllMocks());

    it.each([100, 250, 500, 1000])('removes %i children with linear collection work and correct stored state', async count => {
        const db = await populated(context, count);
        try {
            const [parent, other] = await db.parents.orderBy(row => row.id).include(row => row.children).toArray();
            const children = [...parent.children];
            const unaffected = other.children[0];
            const filters = jest.spyOn(Array.prototype, 'filter');
            const copies = jest.spyOn(collectionCopy, 'copyNavigationCollection');
            db.parents.remove(parent);
            await expect(db.saveChanges()).resolves.toBe(count + 1);
            const filterInputs = Array.from(filters.mock.contexts as readonly unknown[]);
            const copyInputs: unknown[] = copies.mock.calls.map(([value]) => value);
            filters.mockRestore(); copies.mockRestore();
            const childCollections = filterInputs.filter((value): value is RemovalChild[] =>
                Array.isArray(value) && value[0] instanceof RemovalChild);
            expect(childCollections.reduce((sum, value) => sum + value.length, 0)).toBeLessThanOrEqual(4 * count);
            expect(copyInputs.reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0))
                .toBeLessThanOrEqual(16 * (count + 1));
            expect(parent.children).toEqual([]);
            expect(children.every(child => child.parent === null)).toBe(true);
            expect(children.every(child => cascade ? db.entry(child) === undefined
                : child.parentId === null && db.entry(child)?.state === EntityState.Unchanged)).toBe(true);
            expect(other.children).toEqual([unaffected]);
            expect(unaffected.parent).toBe(other);
            expect(await db.parents.asNoTracking().toArray()).toMatchObject([{ id: 2 }]);
            const rows = await db.children.orderBy(row => row.id).asNoTracking().toArray();
            expect(rows).toHaveLength(cascade ? 1 : count + 1);
            expect(rows.at(-1)).toMatchObject({ id: count + 1, parentId: 2 });
            if (!cascade) expect(rows.slice(0, count).every(row => row.parentId === null)).toBe(true);
            expect(db.changeTracker.entries()).toHaveLength(cascade ? 2 : count + 2);
        } finally {
            await db.dispose();
        }
    });

    it('restores database rows and the full navigation graph after a caller transaction rolls back', async () => {
        const db = await populated(context, 32);
        try {
            const [parent] = await db.parents.where(row => row.id.eq(1)).include(row => row.children).toArray();
            const children = [...parent.children];
            db.parents.remove(parent);
            await expect(db.transaction(async transaction => {
                await expect(transaction.saveChanges()).resolves.toBe(33);
                expect(parent.children).toEqual([]);
                expect(children.every(child => child.parent === null)).toBe(true);
                throw new Error('roll back accepted removal');
            })).rejects.toThrow('roll back accepted removal');
            expect(parent.children).toEqual(children);
            expect(children.every(child => child.parent === parent && child.parentId === 1)).toBe(true);
            expect(db.entry(parent)?.state).toBe(EntityState.Deleted);
            expect(children.every(child => db.entry(child)?.state ===
                (cascade ? EntityState.Unchanged : EntityState.Modified))).toBe(true);
            expect(children.every(child => db.entry(child)?.originalValues.parentId === 1)).toBe(true);
            expect(await db.parents.asNoTracking().count()).toBe(2);
            expect(await db.children.asNoTracking().count()).toBe(33);
            await expect(db.saveChanges()).resolves.toBe(33);
            expect(parent.children).toEqual([]);
        } finally {
            await db.dispose();
        }
    });

    it('restores immediate fallback removals after a reference setter refuses, then permits retry', async () => {
        const db = await populated(context, 8);
        try {
            const parent = await db.parents.where(row => row.id.eq(1)).include(row => row.children).single();
            const children = [...parent.children];
            const refusing = children[5];
            let reference = refusing.parent;
            let refuse = true;
            Object.defineProperty(refusing, 'parent', {
                configurable: true, get: () => reference,
                set: (value: RemovalParent | null) => {
                    if (refuse && value === null) throw new Error('refuse severing');
                    reference = value;
                },
            });
            db.parents.remove(parent);
            await expect(db.saveChanges()).rejects.toThrow('refuse severing');
            expect(parent.children).toEqual(children);
            expect(children.every(child => child.parent === parent && child.parentId === 1)).toBe(true);
            expect(children.every(child => db.entry(child)?.state === EntityState.Unchanged)).toBe(true);
            expect(await db.children.asNoTracking().count()).toBe(9);
            refuse = false;
            await expect(db.saveChanges()).resolves.toBe(9);
            expect(parent.children).toEqual([]);
            expect(children.every(child => child.parent === null)).toBe(true);
        } finally {
            await db.dispose();
        }
    });

    it('restores an already-published inverse collection when a later ordinary collection refuses, then permits retry', async () => {
        const db = await populated(context, 8);
        try {
            const [first, second] = await db.parents.orderBy(row => row.id).include(row => row.children).toArray();
            const firstChildren = [...first.children];
            const secondChildren = [...second.children];
            const children = [...firstChildren, ...secondChildren];
            Object.defineProperty(second, 'children', { writable: false });
            const publications: Array<{ principal: object; value: unknown; firstCollection: RemovalChild[] }> = [];
            const write = directNavigationWriter.write.bind(directNavigationWriter);
            const writes = jest.spyOn(directNavigationWriter, 'write').mockImplementation((entity, property, value, name) => {
                if (property === 'children' && (entity === first || entity === second)) {
                    publications.push({ principal: entity, value, firstCollection: first.children });
                }
                return write(entity, property, value, name);
            });
            db.parents.remove(first);
            db.parents.remove(second);
            await expect(db.saveChanges()).rejects.toThrow(TypeError);
            writes.mockRestore();

            // One write per principal proves ordinary batching was selected.
            // Observe the first publication before the refusal and restoration.
            expect(publications.map(item => item.principal)).toEqual([first, second]);
            expect(publications.map(item => item.value)).toEqual([[], []]);
            expect(publications[1].firstCollection).toEqual([]);
            expect(first.children).toEqual(firstChildren);
            expect(second.children).toEqual(secondChildren);
            expect(firstChildren.every(child => child.parent === first && child.parentId === 1)).toBe(true);
            expect(secondChildren.every(child => child.parent === second && child.parentId === 2)).toBe(true);
            expect(children.every(child => db.entry(child)?.state === EntityState.Unchanged)).toBe(true);
            expect(db.entry(first)?.state).toBe(EntityState.Deleted);
            expect(db.entry(second)?.state).toBe(EntityState.Deleted);
            expect(db.changeTracker.entries()).toHaveLength(11);
            expect(await db.parents.orderBy(row => row.id).asNoTracking().toArray()).toMatchObject([{ id: 1 }, { id: 2 }]);
            expect((await db.children.orderBy(row => row.id).asNoTracking().toArray())
                .map(child => ({ id: child.id, parentId: child.parentId })))
                .toEqual(children.map(child => ({ id: child.id, parentId: child.parentId })));

            Object.defineProperty(second, 'children', { writable: true });
            await expect(db.saveChanges()).resolves.toBe(11);
            expect(first.children).toEqual([]);
            expect(second.children).toEqual([]);
            expect(children.every(child => child.parent === null)).toBe(true);
            expect(await db.parents.asNoTracking().count()).toBe(0);
            const stored = await db.children.asNoTracking().toArray();
            expect(stored).toHaveLength(cascade ? 0 : 9);
            expect(stored.every(child => child.parentId === null)).toBe(true);
            expect(children.every(child => cascade ? db.entry(child) === undefined
                : db.entry(child)?.state === EntityState.Unchanged && child.parentId === null)).toBe(true);
            expect(db.changeTracker.entries()).toHaveLength(cascade ? 0 : 9);
        } finally {
            await db.dispose();
        }
    });
});
