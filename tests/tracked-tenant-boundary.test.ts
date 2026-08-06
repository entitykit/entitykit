import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import {
    DbContext,
    DbUpdateConcurrencyError,
    TenantOwnershipError,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class TenantRecord {
    public id = '';
    public tenantId = '';
    public name = '';
}

let currentTenant: string | undefined = 'tenant-1';

class TenantBoundaryContext extends DbContext {
    public records = this.set(TenantRecord);

    constructor(private readonly crossTenant = false) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        const configured = options.useProvider(sqliteProviderServices, ':memory:');
        if (this.crossTenant) {
            configured.allowCrossTenantAccess();
        } else {
            configured.useTenantScope(() => currentTenant);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TenantRecord, entity => {
            entity.toTable('tenant_records');
            entity.hasKey(record => record.id);
            entity.property(record => record.id).hasColumnType('text').isRequired();
            entity.property(record => record.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(record => record.name).hasColumnType('text').isRequired();
            entity.tenantKey(record => record.tenantId);
        });
    }
}

async function open(crossTenant = false): Promise<TenantBoundaryContext> {
    currentTenant = 'tenant-1';
    const db = TenantBoundaryContext.create(crossTenant);
    await db.database.connection.query({
        text: `create table tenant_records (
            id text not null,
            tenant_id text not null,
            name text not null,
            primary key (tenant_id, id)
        )`,
        values: [],
    });
    await db.database.connection.query({
        text: `insert into tenant_records (id, tenant_id, name)
            values (?, ?, ?), (?, ?, ?)`,
        values: [
            'shared', 'tenant-1', 'tenant one',
            'shared', 'tenant-2', 'tenant two',
        ],
    });
    return db;
}

describe('tracked tenant boundary', () => {
    it('binds an entry to the tenant that materialized it', async () => {
        const db = await open();
        const record = requireDefined(await db.records.find('shared'));
        record.name = 'changed';
        currentTenant = 'tenant-2';

        await expect(db.saveChanges()).rejects.toThrow(TenantOwnershipError);
        await expect(db.saveChanges()).rejects.toThrow(
            'does not belong to the current tenant scope',
        );
        await db.dispose();
    });

    it('rejects tenant-key changes on existing scoped entries', async () => {
        const db = await open();
        const record = requireDefined(await db.records.find('shared'));
        record.tenantId = 'tenant-2';
        record.name = 'transferred';

        await expect(db.saveChanges()).rejects.toThrow(TenantOwnershipError);
        await expect(db.saveChanges()).rejects.toThrow(
            'cannot be changed on an existing tracked entity',
        );
        await db.dispose();
    });

    it('does not treat ignoreTenantScope as tracked-write authority', async () => {
        const db = await open();
        const record = await db.records.ignoreTenantScope()
            .where(row => row.tenantId.eq('tenant-2'))
            .single();
        record.name = 'changed';

        await expect(db.saveChanges()).rejects.toThrow(TenantOwnershipError);
        await db.dispose();
    });

    it('turns an external tenant retag into an update conflict', async () => {
        const db = await open();
        const record = requireDefined(await db.records.find('shared'));
        await db.database.connection.query({
            text: `update tenant_records set tenant_id = ?
                where tenant_id = ? and id = ?`,
            values: ['tenant-3', 'tenant-1', 'shared'],
        });
        record.name = 'stale update';

        await expect(db.saveChanges()).rejects.toThrow(
            DbUpdateConcurrencyError,
        );
        await db.dispose();
    });

    it('turns an external tenant retag into a delete conflict', async () => {
        const db = await open();
        const record = requireDefined(await db.records.find('shared'));
        await db.database.connection.query({
            text: `update tenant_records set tenant_id = ?
                where tenant_id = ? and id = ?`,
            values: ['tenant-3', 'tenant-1', 'shared'],
        });
        db.records.remove(record);

        await expect(db.saveChanges()).rejects.toThrow(
            DbUpdateConcurrencyError,
        );
        await db.dispose();
    });

    it('rejects recovery after the tenant scope changes', async () => {
        const db = await open();
        const record = requireDefined(await db.records.find('shared'));
        const entry = requireDefined(db.entry(record));
        currentTenant = 'tenant-2';

        await expect(entry.getDatabaseValues()).rejects.toThrow(
            TenantOwnershipError,
        );
        await expect(entry.reload()).rejects.toThrow(TenantOwnershipError);
        expect(record.name).toBe('tenant one');
        await db.dispose();
    });

    it('permits an explicit cross-tenant context to transfer a row', async () => {
        const db = await open(true);
        const record = await db.records
            .where(row => row.tenantId.eq('tenant-1'))
            .single();
        record.tenantId = 'tenant-3';
        record.name = 'transferred';

        await expect(db.saveChanges()).resolves.toBe(1);
        expect(await db.records
            .where(row => row.tenantId.eq('tenant-3'))
            .count()).toBe(1);
        await db.dispose();
    });
});
