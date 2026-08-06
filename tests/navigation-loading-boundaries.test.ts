import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState, lazy } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class BoundaryParent {
    public id = 0;
    public tenantId = '';
    public name = '';
    public children: BoundaryChild[] = [];
}

class BoundaryChild {
    public id = '';
    public tenantId = '';
    public parentId = 0;
    public name = '';
    public parent?: BoundaryParent;
}

class NavigationBoundaryContext extends DbContext {
    public parents = this.set(BoundaryParent);
    public children = this.set(BoundaryChild);

    constructor(
        private readonly tenantId: string,
        private readonly lazyLoadBudget?: number,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => this.tenantId)
            .useLazyLoading(this.lazyLoadBudget === undefined
                ? {}
                : { maxPerContext: this.lazyLoadBudget });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BoundaryParent, entity => {
            entity.toTable('boundary_parents');
            entity.hasKey(parent => parent.id);
            entity.tenantKey(parent => parent.tenantId);
            entity.property(parent => parent.id).hasColumnType('integer')
                .isRequired().useSqliteRowId({ preventReuse: true });
            entity.property(parent => parent.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(parent => parent.name).hasColumnType('text')
                .isRequired();
        });
        model.entity(BoundaryChild, entity => {
            entity.toTable('boundary_children');
            entity.hasKey(child => child.id);
            entity.tenantKey(child => child.tenantId);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(child => child.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.property(child => child.name).hasColumnType('text').isRequired();
            entity.hasOne(BoundaryParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => child.parentId);
        });
    }
}

async function open(
    tenantId: string,
    lazyLoadBudget?: number,
): Promise<NavigationBoundaryContext> {
    const db = NavigationBoundaryContext.create(tenantId, lazyLoadBudget);
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

async function seed(
    db: NavigationBoundaryContext,
    tenantId: string,
    parentName: string,
    childName?: string,
): Promise<void> {
    await db.database.connection.query({
        text: 'insert into boundary_parents (id, tenant_id, name) values (?, ?, ?)',
        values: [1, tenantId, parentName],
    });
    if (childName) {
        await db.database.connection.query({
            text: `insert into boundary_children
                (id, tenant_id, parent_id, name) values (?, ?, ?, ?)`,
            values: ['child-1', tenantId, 1, childName],
        });
    }
}

describe('navigation loading boundaries', () => {
    it('does not stitch entities across physical databases', async () => {
        const first = await open('shared');
        const second = await open('shared');
        await seed(first, 'shared', 'parent from first');
        await seed(second, 'shared', 'parent from second', 'child from second');
        const parent = await first.parents.find(1);
        if (!parent) throw new Error('Expected the first parent to load.');
        const entry = first.entry(parent);
        if (!entry) throw new Error('Expected the first parent to be tracked.');

        await expect(second.loadNavigation(entry, 'children')).rejects.toThrow(
            'EntityEntry belongs to another DbContext or is no longer tracked.',
        );
        expect(parent.name).toBe('parent from first');
        expect(parent.children).toEqual([]);
        expect(first.changeTracker.entries()).toHaveLength(1);
        expect(second.changeTracker.entries()).toEqual([]);
        await first.dispose();
        await second.dispose();
    });

    it('does not stitch entities across tenant scopes', async () => {
        const first = await open('tenant-1');
        const second = await open('tenant-2');
        await seed(first, 'tenant-1', 'tenant one parent');
        await seed(second, 'tenant-2', 'tenant two parent', 'tenant two child');
        const parent = await first.parents.find(1);
        if (!parent) throw new Error('Expected the tenant parent to load.');
        const entry = first.entry(parent);
        if (!entry) throw new Error('Expected the tenant parent to be tracked.');

        await expect(second.loadNavigation(entry, 'children')).rejects.toThrow(
            'EntityEntry belongs to another DbContext or is no longer tracked.',
        );
        expect(parent.tenantId).toBe('tenant-1');
        expect(parent.children).toEqual([]);
        expect(second.changeTracker.entries()).toEqual([]);
        await first.dispose();
        await second.dispose();
    });

    it('does not load through a generated-key placeholder', async () => {
        const db = await open('tenant-1', 1);
        await db.database.connection.query({
            text: 'insert into boundary_parents (id, tenant_id, name) values (?, ?, ?)',
            values: [0, 'tenant-1', 'persisted zero'],
        });
        await db.database.connection.query({
            text: `insert into boundary_children
                (id, tenant_id, parent_id, name) values (?, ?, ?, ?)`,
            values: ['zero-child', 'tenant-1', 0, 'persisted child'],
        });
        const fresh = Object.assign(new BoundaryParent(), { name: 'fresh' });
        const entry = db.parents.add(fresh);

        await expect(entry.collection(parent => parent.children).load())
            .rejects.toThrow(
                'Navigation loading is unavailable for an Added entity because it has no persisted identity.',
            );
        await expect(lazy(fresh).children).rejects.toThrow(
            'Navigation loading is unavailable for an Added entity because it has no persisted identity.',
        );
        expect(entry.state).toBe(EntityState.Added);
        expect(fresh.id).toBe(0);
        expect(fresh.children).toEqual([]);
        expect(db.changeTracker.entries()).toEqual([entry]);
        const persisted = await db.parents.find(0);
        if (!persisted) throw new Error('Expected the zero parent to load.');
        await expect(lazy(persisted).children).resolves.toHaveLength(1);
        const stored = await db.database.connection.query<{
            parent_id: number;
        }>({
            text: 'select parent_id from boundary_children where id = ?',
            values: ['zero-child'],
        });
        expect(stored.rows).toEqual([{ parent_id: 0 }]);
        await db.dispose();
    });

    it('rejects a changed key without consuming the lazy-load budget', async () => {
        const db = await open('tenant-1', 1);
        await seed(db, 'tenant-1', 'parent', 'child');
        const parent = await db.parents.find(1);
        if (!parent) throw new Error('Expected the parent to load.');
        parent.id = 2;

        await expect(lazy(parent).children).rejects.toThrow(
            'Primary key changes are not supported',
        );
        parent.id = 1;
        await expect(lazy(parent).children).resolves.toHaveLength(1);
        await db.dispose();
    });
});
