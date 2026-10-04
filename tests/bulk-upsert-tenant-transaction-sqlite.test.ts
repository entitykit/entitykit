import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class TenantOnlyUpsertRow {
    public id = '';
    public label = '';
    public tenantId?: string;
}

class TenantOnlyUpsertContext extends DbContext {
    public rows = this.set(TenantOnlyUpsertRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TenantOnlyUpsertRow, entity => {
            entity.toTable('tenant_only_upsert_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

describe('tenant-only upsert transaction state', () => {
    it('restores a non-generated tenant stamp after outer rollback', async () => {
        const db = TenantOnlyUpsertContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const incoming = Object.assign(new TenantOnlyUpsertRow(), {
            id: 'row-one',
            label: 'row one',
        });

        await expect(db.transaction(async transaction => {
            await expect(transaction.rows.executeUpsert([incoming])).resolves.toBe(1);
            expect(incoming.tenantId).toBe('tenant-one');
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(incoming.tenantId).toBeUndefined();
        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });
});
