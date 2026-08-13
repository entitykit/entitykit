import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class FilterParent {
    public id = '';
    public tenantId = '';
    public deletedAt: Date | null = null;
    public children: FilterChild[] = [];
}

class FilterChild {
    public id = '';
    public tenantId = '';
    public parentId = '';
    public parent: FilterParent | null = null;
}

class FilterReferenceContext extends DbContext {
    public parents = this.set(FilterParent);
    public children = this.set(FilterChild);

    constructor(
        private readonly tenant = 't1',
        private readonly crossTenant = false,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        if (this.crossTenant) options.allowCrossTenantAccess();
        else options.useTenantScope(() => this.tenant);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(FilterParent, entity => {
            entity.toTable('filter_parents');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('timestamp').isOptional();
            entity.softDelete(row => row.deletedAt);
        });
        model.entity(FilterChild, entity => {
            entity.toTable('filter_children');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(FilterParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId)
                .onDelete(DeleteBehavior.NoAction);
        });
    }
}

async function open(crossTenant = false): Promise<FilterReferenceContext> {
    const db = FilterReferenceContext.create('t1', crossTenant);
    await db.database.connection.query({
        text: `create table filter_parents (
            id text not null, tenant_id text not null, deleted_at text null,
            primary key (tenant_id, id)
        ); create table filter_children (
            id text not null, tenant_id text not null, parent_id text not null,
            primary key (tenant_id, id)
        )`,
        values: [],
    });
    return db;
}

describe('filtered null reference state', () => {
    it('does not reconnect a tracked soft-deleted principal', async () => {
        const db = await open();
        await db.database.connection.query({
            text: `insert into filter_parents (id, tenant_id, deleted_at)
                values (?, ?, ?)`,
            values: ['p', 't1', '2026-01-01'],
        });
        await db.database.connection.query({
            text: `insert into filter_children (id, tenant_id, parent_id)
                values (?, ?, ?)`,
            values: ['c', 't1', 'p'],
        });
        const deleted = await db.parents.ignoreQueryFilters().single();
        const child = await db.children.where(row =>
            row.id.eq('c').and(row.tenantId.eq('t1'))).single();

        await expect(requireDefined(db.entry(child))
            .reference(row => row.parent).load()).resolves.toBeNull();
        db.changeTracker.detectChanges();

        expect(child.parent).toBeNull();
        expect(deleted.children).toEqual([]);
        await db.dispose();
    });

    it('accepts loader removal from a previously loaded hidden inverse', async () => {
        const db = await open();
        await db.database.connection.query({
            text: `insert into filter_parents (id, tenant_id, deleted_at)
                values (?, ?, ?)`,
            values: ['p', 't1', '2026-01-01'],
        });
        await db.database.connection.query({
            text: `insert into filter_children (id, tenant_id, parent_id)
                values (?, ?, ?)`,
            values: ['c', 't1', 'p'],
        });
        const hidden = await db.parents.ignoreQueryFilters()
            .include(row => row.children).single();
        const child = requireDefined(hidden.children[0]);

        await expect(requireDefined(db.entry(child))
            .reference(row => row.parent).load()).resolves.toBeNull();
        expect(hidden.children).toEqual([]);
        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        expect(child.parentId).toBe('p');
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });

    it('accepts loader removal from a previously loaded tenant-excluded inverse', async () => {
        const db = await open();
        await db.database.connection.query({
            text: `insert into filter_parents (id, tenant_id, deleted_at)
                values (?, ?, null)`,
            values: ['p', 't2'],
        });
        await db.database.connection.query({
            text: `insert into filter_children (id, tenant_id, parent_id)
                values (?, ?, ?)`,
            values: ['c', 't1', 'p'],
        });
        const other = await db.parents.ignoreTenantScope()
            .include(row => row.children).single();
        const child = requireDefined(other.children[0]);

        await expect(requireDefined(db.entry(child))
            .reference(row => row.parent).load()).resolves.toBeNull();
        expect(other.children).toEqual([]);
        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        expect(child.parentId).toBe('p');
        db.parents.detach(other);
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });

    it('does not reconnect a tracked principal from another tenant', async () => {
        const db = await open();
        await db.database.connection.query({
            text: `insert into filter_parents (id, tenant_id, deleted_at)
                values (?, ?, null)`,
            values: ['p', 't2'],
        });
        await db.database.connection.query({
            text: `insert into filter_children (id, tenant_id, parent_id)
                values (?, ?, ?)`,
            values: ['c', 't1', 'p'],
        });
        const other = await db.parents.ignoreTenantScope().single();
        const child = requireDefined(await db.children.find('c'));

        await expect(requireDefined(db.entry(child))
            .reference(row => row.parent).load()).resolves.toBeNull();
        db.changeTracker.detectChanges();

        expect(child.parent).toBeNull();
        expect(other.children).toEqual([]);
        await db.dispose();
    });

    it('reconsiders a filtered-null result after the FK changes', async () => {
        const db = await open();
        await db.database.connection.query({
            text: `insert into filter_parents (id, tenant_id, deleted_at)
                values (?, ?, ?), (?, ?, null)`,
            values: ['hidden', 't1', '2026-01-01', 'visible', 't1'],
        });
        await db.database.connection.query({
            text: `insert into filter_children (id, tenant_id, parent_id)
                values (?, ?, ?)`,
            values: ['c', 't1', 'hidden'],
        });
        await db.parents.ignoreQueryFilters()
            .where(row => row.id.eq('hidden')).single();
        const visible = await db.parents.where(row => row.id.eq('visible')).single();
        const child = requireDefined(await db.children.find('c'));
        await requireDefined(db.entry(child)).reference(row => row.parent).load();
        child.parentId = 'visible';

        db.changeTracker.detectChanges();

        expect(child.parent).toBe(visible);
        await db.dispose();
    });

    it('allows a deliberately cross-tenant context to load the principal', async () => {
        const db = await open(true);
        await db.database.connection.query({
            text: `insert into filter_parents (id, tenant_id, deleted_at)
                values (?, ?, null)`,
            values: ['p', 't2'],
        });
        await db.database.connection.query({
            text: `insert into filter_children (id, tenant_id, parent_id)
                values (?, ?, ?)`,
            values: ['c', 't1', 'p'],
        });
        const child = await db.children.where(row =>
            row.id.eq('c').and(row.tenantId.eq('t1'))).single();

        const loaded = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(loaded?.tenantId).toBe('t2');
        expect(child.parent).toBe(loaded);
        await db.dispose();
    });
});
