import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, valueConverter } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class TenantScope {
    constructor(public readonly value: string) {}
}

const queryScope = new TenantScope('scope');
let scopeConversions = 0;

const tenantConverter = valueConverter<TenantScope, string>({
    toProvider: value => {
        if (value === queryScope) {
            scopeConversions += 1;
            return scopeConversions === 1 ? 'tenant-one' : 'tenant-two';
        }
        return value.value;
    },
    fromProvider: value => new TenantScope(value),
});

class BoundTenantParent {
    public id = '';
    public tenantId!: TenantScope;
    public children: BoundTenantChild[] = [];
}

class BoundTenantChild {
    public id = '';
    public tenantId!: TenantScope;
    public parentId = '';
    public parent?: BoundTenantParent;
}

class BoundTenantQueryContext extends DbContext {
    public parents = this.set(BoundTenantParent);
    public children = this.set(BoundTenantChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => queryScope);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BoundTenantParent, entity => {
            entity.toTable('bound_tenant_parents');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
        });
        model.entity(BoundTenantChild, entity => {
            entity.toTable('bound_tenant_children');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(BoundTenantParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

describe('query-bound tenant facts', () => {
    it('reuses one provider tenant through a split include', async () => {
        scopeConversions = 0;
        const db = BoundTenantQueryContext.create();
        await db.database.connection.query({
            text: `create table bound_tenant_parents (
                id text not null, tenant_id text not null,
                primary key (tenant_id, id)
            ); create table bound_tenant_children (
                id text not null, tenant_id text not null, parent_id text not null,
                primary key (tenant_id, id)
            )`,
            values: [],
        });
        await db.database.connection.query({
            text: `insert into bound_tenant_parents (id, tenant_id)
                values (?, ?)`,
            values: ['parent', 'tenant-one'],
        });
        await db.database.connection.query({
            text: `insert into bound_tenant_children (id, tenant_id, parent_id)
                values (?, ?, ?), (?, ?, ?)`,
            values: [
                'child-one', 'tenant-one', 'parent',
                'child-two', 'tenant-two', 'parent',
            ],
        });

        const parent = await db.parents
            .include(row => row.children)
            .single();

        expect(parent.tenantId.value).toBe('tenant-one');
        expect(parent.children.map(child => [
            child.id,
            child.tenantId.value,
        ])).toEqual([['child-one', 'tenant-one']]);
        expect(scopeConversions).toBe(1);
        await db.dispose();
    });

    it('reuses one provider tenant through explicit navigation loading', async () => {
        scopeConversions = 0;
        const db = BoundTenantQueryContext.create();
        await db.database.connection.query({
            text: `create table bound_tenant_parents (
                id text not null, tenant_id text not null,
                primary key (tenant_id, id)
            ); create table bound_tenant_children (
                id text not null, tenant_id text not null, parent_id text not null,
                primary key (tenant_id, id)
            )`,
            values: [],
        });
        await db.database.connection.query({
            text: `insert into bound_tenant_children (id, tenant_id, parent_id)
                values (?, ?, ?), (?, ?, ?)`,
            values: [
                'child-one', 'tenant-one', 'parent',
                'child-two', 'tenant-two', 'parent',
            ],
        });
        const parent = Object.assign(new BoundTenantParent(), {
            id: 'parent', tenantId: new TenantScope('tenant-one'),
        });
        db.parents.attach(parent);
        scopeConversions = 0;

        const children = await requireDefined(db.entry(parent))
            .collection(row => row.children).load();

        expect(children.map(child => child.id)).toEqual(['child-one']);
        expect(scopeConversions).toBe(1);
        await db.dispose();
    });
});
