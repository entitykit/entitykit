import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class RequiredParent {
    public id = '';
    public children: RequiredChild[] = [];
}

class RequiredChild {
    public id = '';
    public parentId = '';
    public parent: RequiredParent | null = null;
}

class RequiredContext extends DbContext {
    public parents = this.set(RequiredParent);
    public children = this.set(RequiredChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RequiredParent, entity => {
            entity.toTable('required_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(RequiredChild, entity => {
            entity.toTable('required_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(RequiredParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

class UnstableChild {
    public id = '';
    public parent: RequiredParent | null = null;
    private storedParentId = '';
    private nextParentIds: string[] = [];

    public get parentId(): string {
        return this.nextParentIds.shift() ?? this.storedParentId;
    }

    public set parentId(value: string) {
        this.storedParentId = value;
    }

    public drift(first: string, then: string): void {
        this.nextParentIds = [first];
        this.storedParentId = then;
    }
}

class UnstableContext extends DbContext {
    public parents = this.set(RequiredParent);
    public children = this.set(UnstableChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RequiredParent, entity => {
            entity.toTable('unstable_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(UnstableChild, entity => {
            entity.toTable('unstable_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(RequiredParent, row => row.parent)
                .withMany()
                .hasForeignKey(row => row.parentId);
        });
    }
}

describe('relationship detection idempotence', () => {
    it('does not rewrite a converged FK setter on repeated detection', async () => {
        const db = RequiredContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        const p1 = Object.assign(new RequiredParent(), { id: 'p1' });
        const p2 = Object.assign(new RequiredParent(), { id: 'p2' });
        const child = Object.assign(new RequiredChild(), {
            id: 'c', parentId: 'p1', parent: p1,
        });
        db.parents.attach(p1);
        db.parents.attach(p2);
        db.children.attach(child);
        let parentId = child.parentId;
        let writes = 0;
        Object.defineProperty(child, 'parentId', {
            configurable: true,
            get: () => parentId,
            set: (value: string) => {
                writes += 1;
                parentId = value;
            },
        });
        child.parent = p2;

        db.changeTracker.detectChanges();
        db.changeTracker.detectChanges();

        expect(child.parentId).toBe('p2');
        expect(writes).toBe(1);
        await db.dispose();
    });

    it('preserves an inverse edit until its dependent becomes tracked', () => {
        const db = RequiredContext.create();
        const parent = Object.assign(new RequiredParent(), { id: 'p1' });
        const child = Object.assign(new RequiredChild(), { id: 'c' });
        db.parents.attach(parent);
        parent.children.push(child);

        db.changeTracker.detectChanges();
        expect(child.parentId).toBe('');

        db.children.attach(child);
        db.changeTracker.detectChanges();

        expect(child.parentId).toBe('p1');
        expect(child.parent).toBe(parent);
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
    });

    it('converges for a required FK-only change', async () => {
        const db = RequiredContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        await db.database.connection.query({
            text: 'insert into required_parents (id) values (?), (?)',
            values: ['p1', 'p2'],
        });
        await db.database.connection.query({
            text: 'insert into required_children (id, parent_id) values (?, ?)',
            values: ['c', 'p1'],
        });
        const child = requireDefined(await db.children.find('c'));
        await requireDefined(db.entry(child)).reference(row => row.parent).load();
        child.parentId = 'p2';

        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();

        expect(child.parentId).toBe('p2');
        expect(child.parent).toBeNull();
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });

    it('keeps unstable FK reads within one captured generation', async () => {
        const db = UnstableContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        await db.database.connection.query({
            text: 'insert into unstable_parents (id) values (?), (?)',
            values: ['p1', 'p2'],
        });
        await db.database.connection.query({
            text: 'insert into unstable_children (id, parent_id) values (?, ?)',
            values: ['c', 'p1'],
        });
        const child = requireDefined(await db.children.find('c'));
        await requireDefined(db.entry(child)).reference(row => row.parent).load();
        child.drift('p1', 'p2');

        await expect(db.saveChanges()).resolves.toBe(0);
        expect(child.parent?.id).toBe('p1');
        await expect(db.saveChanges()).resolves.toBe(1);

        const stored = await db.database.connection.query<{ parent_id: string }>({
            text: 'select parent_id from unstable_children where id = ?',
            values: ['c'],
        });
        expect(stored.rows).toEqual([{ parent_id: 'p2' }]);
        expect(child.parent).toBeNull();
        expect(db.getSavePlan()).toEqual([]);
        await db.dispose();
    });
});
