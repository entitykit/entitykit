import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class ZeroParent {
    public id = 0;
    public name = '';
    public children: ZeroChild[] = [];
}

class ZeroChild {
    public id = '';
    public parentId = 0;
    public parent!: ZeroParent;
}

class GeneratedZeroGraphContext extends DbContext {
    public parents = this.set(ZeroParent);
    public children = this.set(ZeroChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ZeroParent, entity => {
            entity.toTable('zero_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(parent => parent.name).hasColumnType('text').isRequired();
        });
        model.entity(ZeroChild, entity => {
            entity.toTable('zero_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(ZeroParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => child.parentId);
        });
    }
}

describe('generated numeric zero graph keys', () => {
    it('replaces a temporary zero FK instead of linking an existing zero row', async () => {
        const db = GeneratedZeroGraphContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: 'insert into zero_parents (id, name) values (?, ?)',
            values: [0, 'existing-zero'],
        });
        const parent = Object.assign(new ZeroParent(), { name: 'new-parent' });
        const child = Object.assign(new ZeroChild(), {
            id: 'new-child',
            parent,
        });
        parent.children = [child];
        db.children.add(child);
        db.parents.add(parent);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(parent.id).toBe(1);
        expect(child.parentId).toBe(1);
        const stored = await db.database.connection.query<{
            parent_id: number;
        }>({
            text: 'select parent_id from zero_children where id = ?',
            values: ['new-child'],
        });
        expect(stored.rows).toEqual([{ parent_id: 1 }]);
        await db.dispose();
    });

    it('preserves an explicit zero FK to an existing tracked principal', async () => {
        const db = GeneratedZeroGraphContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: 'insert into zero_parents (id, name) values (?, ?)',
            values: [0, 'existing-zero'],
        });
        const parent = Object.assign(new ZeroParent(), {
            id: 0,
            name: 'existing-zero',
        });
        const child = Object.assign(new ZeroChild(), {
            id: 'existing-child',
            parentId: 0,
            parent,
        });
        db.parents.attach(parent);
        db.children.add(child);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(child.parentId).toBe(0);
        const stored = await db.database.connection.query<{
            parent_id: number;
        }>({
            text: 'select parent_id from zero_children where id = ?',
            values: ['existing-child'],
        });
        expect(stored.rows).toEqual([{ parent_id: 0 }]);
        await db.dispose();
    });

    it('keeps repeated zero placeholders associated with their own principals', async () => {
        const db = GeneratedZeroGraphContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const firstParent = Object.assign(new ZeroParent(), { name: 'first' });
        const secondParent = Object.assign(new ZeroParent(), { name: 'second' });
        const firstChild = Object.assign(new ZeroChild(), {
            id: 'first-child', parent: firstParent,
        });
        const secondChild = Object.assign(new ZeroChild(), {
            id: 'second-child', parent: secondParent,
        });
        db.children.add(firstChild);
        db.children.add(secondChild);
        db.parents.add(firstParent);
        db.parents.add(secondParent);

        await expect(db.saveChanges()).resolves.toBe(4);

        expect(firstChild.parentId).toBe(firstParent.id);
        expect(secondChild.parentId).toBe(secondParent.id);
        expect(firstParent.id).not.toBe(secondParent.id);
        const rows = await db.database.connection.query<{
            id: string;
            parent_id: number;
        }>({
            text: 'select id, parent_id from zero_children order by id',
            values: [],
        });
        expect(rows.rows).toEqual([
            { id: 'first-child', parent_id: firstParent.id },
            { id: 'second-child', parent_id: secondParent.id },
        ]);
        await db.dispose();
    });
});
