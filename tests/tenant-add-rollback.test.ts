import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class AccessorTenantRow {
    readonly #values: { tenantId?: string } = {};

    public id = '';
    public name = '';

    public get tenantId(): string | undefined {
        return this.#values.tenantId;
    }

    public set tenantId(value: string | undefined) {
        this.#values.tenantId = value;
    }
}

class AccessorTenantContext extends DbContext {
    public rows = this.set(AccessorTenantRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'tenant-1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AccessorTenantRow, entity => {
            entity.toTable('accessor_tenant_rows');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

describe('tenant stamping rollback', () => {
    it('restores an accessor-backed value when tracking rejects add()', () => {
        const db = AccessorTenantContext.create();
        const accepted = Object.assign(new AccessorTenantRow(), {
            id: 'duplicate',
            name: 'accepted',
        });
        const rejected = Object.assign(new AccessorTenantRow(), {
            id: 'duplicate',
            name: 'rejected',
        });
        db.rows.add(accepted);

        expect(Object.hasOwn(rejected, 'tenantId')).toBe(false);
        expect(() => db.rows.add(rejected)).toThrow('already tracked');

        expect(rejected.tenantId).toBeUndefined();
        expect(Object.hasOwn(rejected, 'tenantId')).toBe(false);
        expect(db.entry(rejected)).toBeUndefined();
        expect(accepted.tenantId).toBe('tenant-1');
    });
});
