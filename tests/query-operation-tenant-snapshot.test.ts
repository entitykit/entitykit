import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class ScopedParent {
    public id = 0;
    public tenantId = '';
    public children: ScopedChild[] = [];
}

class ScopedChild {
    public id = '';
    public tenantId = '';
    public parentId = 0;
    public parent?: ScopedParent;
    public leaves: ScopedLeaf[] = [];
}

class ScopedLeaf {
    public id = '';
    public tenantId = '';
    public childId = '';
    public child?: ScopedChild;
}

class TenantSequence {
    private values: string[] = ['tenant-1'];
    public calls = 0;

    public next(): string {
        this.calls += 1;
        return this.values.shift() ?? 'tenant-2';
    }

    public reset(...values: string[]): void {
        this.values = [...values];
        this.calls = 0;
    }
}

class QueryOperationContext extends DbContext {
    public parents = this.set(ScopedParent);
    public children = this.set(ScopedChild);
    public leaves = this.set(ScopedLeaf);

    constructor(public readonly tenants: TenantSequence) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => this.tenants.next());
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ScopedParent, entity => {
            entity.toTable('scope_parents');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
        });
        model.entity(ScopedChild, entity => {
            entity.toTable('scope_children');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(ScopedParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(ScopedLeaf, entity => {
            entity.toTable('scope_leaves');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.childId).hasColumnName('child_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(ScopedChild, row => row.child)
                .withMany(child => child.leaves)
                .hasForeignKey(row => row.childId);
        });
    }
}

async function open(): Promise<QueryOperationContext> {
    const tenants = new TenantSequence();
    const db = QueryOperationContext.create(tenants);
    await db.database.connection.query({
        text: `create table scope_parents (
            id integer not null, tenant_id text not null,
            primary key (tenant_id, id)
        ); create table scope_children (
            id text not null, tenant_id text not null, parent_id integer not null,
            primary key (tenant_id, id)
        ); create table scope_leaves (
            id text not null, tenant_id text not null, child_id text not null,
            primary key (tenant_id, id)
        )`,
        values: [],
    });
    for (const statement of [
        {
            text: `insert into scope_parents (id, tenant_id)
                values (?, ?), (?, ?)`,
            values: [1, 'tenant-1', 1, 'tenant-2'],
        },
        {
            text: `insert into scope_children (id, tenant_id, parent_id)
                values (?, ?, ?), (?, ?, ?)`,
            values: ['child', 'tenant-1', 1, 'child', 'tenant-2', 1],
        },
        {
            text: `insert into scope_leaves (id, tenant_id, child_id)
                values (?, ?, ?), (?, ?, ?)`,
            values: ['leaf-1', 'tenant-1', 'child', 'leaf-2', 'tenant-2', 'child'],
        },
    ]) {
        await db.database.connection.query(statement);
    }
    tenants.reset('tenant-1');
    return db;
}

describe('query operation tenant snapshot', () => {
    it('uses one tenant for a root query and its split include', async () => {
        const db = await open();
        db.tenants.reset('tenant-1', 'tenant-2');

        const parent = await db.parents.include(row => row.children).single();

        expect(parent.tenantId).toBe('tenant-1');
        expect(parent.children).toHaveLength(1);
        expect(parent.children[0]?.tenantId).toBe('tenant-1');
        expect(db.tenants.calls).toBe(1);
        await db.dispose();
    });

    it('uses one tenant across nested split includes', async () => {
        const db = await open();
        db.tenants.reset('tenant-1', 'tenant-1', 'tenant-2');

        const parent = await db.parents
            .include(row => row.children)
            .thenInclude(child => child.leaves)
            .single();

        expect(parent.children[0]?.leaves.map(leaf => leaf.id)).toEqual(['leaf-1']);
        expect(parent.children[0]?.leaves[0]?.tenantId).toBe('tenant-1');
        expect(db.tenants.calls).toBe(1);
        await db.dispose();
    });

    it('uses one tenant for an explicit navigation boundary and query', async () => {
        const db = await open();
        const parent = requireDefined(await db.parents.find(1));
        db.tenants.reset('tenant-1', 'tenant-2');

        const children = await requireDefined(db.entry(parent))
            .collection(row => row.children).load();

        expect(children).toHaveLength(1);
        expect(children[0]?.tenantId).toBe('tenant-1');
        expect(db.tenants.calls).toBe(1);
        await db.dispose();
    });
});
