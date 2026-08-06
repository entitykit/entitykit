import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, TenantIdentityAmbiguityError } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class TenantIdentityRow {
    public id = '';
    public tenantId = '';
    public name = '';
}

let tenantId = 'tenant-1';

class TenantIdentityContext extends DbContext {
    public rows = this.set(TenantIdentityRow);

    constructor(private readonly crossTenant = false) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        const configured = options.useProvider(sqliteProviderServices, ':memory:');
        if (this.crossTenant) {
            configured.allowCrossTenantAccess();
        } else {
            configured.useTenantScope(() => tenantId);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TenantIdentityRow, entity => {
            entity.toTable('tenant_identity_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

async function open(crossTenant = false): Promise<TenantIdentityContext> {
    tenantId = 'tenant-1';
    const db = TenantIdentityContext.create(crossTenant);
    await db.database.connection.query({
        text: `create table tenant_identity_rows (
            id text not null,
            tenant_id text not null,
            name text not null,
            primary key (tenant_id, id)
        )`,
        values: [],
    });
    await db.database.connection.query({
        text: `insert into tenant_identity_rows (id, tenant_id, name)
            values (?, ?, ?), (?, ?, ?)`,
        values: [
            'shared', 'tenant-1', 'one',
            'shared', 'tenant-2', 'two',
        ],
    });
    return db;
}

describe('tenant-aware identity resolution', () => {
    it('does not substitute a cached entity from another tenant', async () => {
        const db = await open();
        const first = requireDefined(await db.rows.find('shared'));
        tenantId = 'tenant-2';

        const second = await db.rows.single();

        expect(first).toMatchObject({ tenantId: 'tenant-1', name: 'one' });
        expect(second).toMatchObject({ tenantId: 'tenant-2', name: 'two' });
        expect(second).not.toBe(first);
        expect(db.changeTracker.entries()).toHaveLength(2);
        await db.dispose();
    });

    it('lets find query for the current tenant after a cache miss', async () => {
        const db = await open();
        const first = requireDefined(await db.rows.find('shared'));
        tenantId = 'tenant-2';

        const second = requireDefined(await db.rows.find('shared'));

        expect(second).not.toBe(first);
        expect(second).toMatchObject({ tenantId: 'tenant-2', name: 'two' });
        await db.dispose();
    });

    it('keeps overlapping rows distinct in a cross-tenant query', async () => {
        const db = await open(true);

        const rows = await db.rows.orderBy(row => row.tenantId).toArray();

        expect(rows.map(row => row.name)).toEqual(['one', 'two']);
        expect(rows[0]).not.toBe(rows[1]);
        expect(db.changeTracker.entries()).toHaveLength(2);
        await db.dispose();
    });

    it('keeps query-local no-tracking identities tenant-aware', async () => {
        const db = await open(true);

        const rows = await db.rows.asNoTracking()
            .orderBy(row => row.tenantId).toArray();

        expect(rows.map(row => row.name)).toEqual(['one', 'two']);
        expect(rows[0]).not.toBe(rows[1]);
        expect(db.changeTracker.entries()).toEqual([]);
        await db.dispose();
    });

    it('rejects ambiguous find in a cross-tenant context', async () => {
        const db = await open(true);

        await expect(db.rows.find('shared')).rejects.toThrow(
            TenantIdentityAmbiguityError,
        );
        await db.dispose();
    });

    it('tracks same-key additions separately by tenant', async () => {
        const db = await open(true);
        const first = Object.assign(new TenantIdentityRow(), {
            id: 'new', tenantId: 'tenant-1', name: 'one',
        });
        const second = Object.assign(new TenantIdentityRow(), {
            id: 'new', tenantId: 'tenant-2', name: 'two',
        });

        db.rows.add(first);
        db.rows.add(second);

        expect(db.changeTracker.entries()).toHaveLength(2);
        await db.dispose();
    });
});
