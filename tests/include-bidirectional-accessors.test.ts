import { DbContext, EntityState, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class DomainParent {
    public id = 0;
    public children: DomainChild[] = [];
}
class DomainChild {
    public id = 0;
    public parentId = 0;
    private parentValue: DomainParent | null = null;
    public get parent(): DomainParent | null {
        return this.parentValue;
    }
    public set parent(value: DomainParent | null) {
        if (this.parentValue === value) return;
        if (this.parentValue) this.parentValue.children = this.parentValue.children.filter(child => child !== this);
        this.parentValue = value;
        if (value && !value.children.includes(this)) value.children.push(this);
    }
}
class DomainContext extends DbContext {
    public parents = this.set(DomainParent);
    public children = this.set(DomainChild);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(DomainParent, entity => {
            entity.toTable('domain_parents'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(DomainChild, entity => {
            entity.toTable('domain_children'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer').isRequired();
            entity.hasOne(DomainParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

describe('reference includes with bidirectional domain setters', () => {
    it.each([false, true])('selects a compatible path before the first reference write (first is data=%s)', async firstIsData => {
        const db = DomainContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({ text: 'insert into domain_parents values (7)', values: [] });
            await db.database.connection.query({ text: 'insert into domain_children values (1, 7), (2, 7)', values: [] });
            if (firstIsData) {
                const first = await db.children.where(row => row.id.eq(1)).single();
                Object.defineProperty(first, 'parent', { value: null, writable: true });
            }
            const children = await db.children.orderBy(row => row.id).include(row => row.parent).toArray();
            const parent = children[0].parent;
            expect(parent).toBeInstanceOf(DomainParent);
            expect(children).toHaveLength(2);
            expect(children.every(child => child.parent === parent)).toBe(true);
            expect(parent?.children).toEqual(children);
            expect(new Set(parent?.children).size).toBe(2);
            expect(children.every(child => db.entry(child)?.isNavigationLoaded('parent'))).toBe(true);
            await expect(db.saveChanges()).resolves.toBe(0);
            expect(db.changeTracker.entries().every(entry => entry.state === EntityState.Unchanged)).toBe(true);
            expect(await db.children.asNoTracking().count()).toBe(2);
        } finally {
            await db.dispose();
        }
    });
});
