import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    RuntimeDiagnosticEvent,
} from '../../src';
import { DbContext } from '../../src';
import { sqliteProviderServices } from '../../src/providers/sqlite';

export class Item {
    public id!: string;
    public tenantId!: string;
    public sku!: string;
    public name!: string;
    public quantity!: number;

    constructor(data?: Partial<Item>) {
        Object.assign(this, data);
    }
}

let currentTenant: string | undefined = 't1';
let scoped = true;
let crossTenant = false;

class CatalogDbContext extends DbContext {
    public items = this.set(Item);
    public readonly plans: Array<Extract<RuntimeDiagnosticEvent, { kind: 'queryPlan' }>> = [];

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        if (scoped) {
            if (crossTenant) {
                options.allowCrossTenantAccess();
            } else {
                options.useTenantScope(() => currentTenant);
            }
        }
        options.useDiagnostics(event => {
            if (event.kind === 'queryPlan') {
                this.plans.push(event);
            }
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Item, entity => {
            entity.toTable('items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(item => item.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            entity.property(item => item.sku).hasColumnName('sku').hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(item => item.quantity).hasColumnName('quantity').hasColumnType('integer').isRequired();
            entity.hasIndex(item => [item.tenantId, item.sku]).isUnique();
            if (scoped) {
                entity.tenantKey(item => item.tenantId);
            }
        });
    }
}

export async function openBulkUpsertDb(): Promise<CatalogDbContext> {
    const db = CatalogDbContext.create();
    await db.database.connection.query({
        text: 'create table items (id text primary key, tenant_id text not null, sku text not null, name text not null, quantity integer not null)',
        values: [],
    });
    await db.database.connection.query({ text: 'create unique index ux_items_tenant_sku on items (tenant_id, sku)', values: [] });
    db.plans.length = 0;
    return db;
}

export function item(id: string, overrides: Partial<Item> = {}): Item {
    return new Item({ id, tenantId: 't1', sku: `sku-${id}`, name: `Name ${id}`, quantity: 1, ...overrides });
}

export const bulkUpsertFixture = {
    reset(): void {
        currentTenant = 't1';
        scoped = true;
        crossTenant = false;
    },
    useTenant(tenant: string | undefined): void {
        currentTenant = tenant;
    },
    withoutTenantKey(): void {
        scoped = false;
    },
    allowCrossTenantAccess(): void {
        crossTenant = true;
    },
};
