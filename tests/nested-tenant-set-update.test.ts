import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import {
    DbContext,
    TenantOwnershipError,
    valueConverter,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class TenantId {
    constructor(public readonly value: string) {}
}

const tenantIdConverter = valueConverter<TenantId, string>({
    toProvider: value => value.value,
    fromProvider: value => new TenantId(value),
});

class TenantScope {
    public tenantId = new TenantId('');
}

class RequiredTenantRow {
    public id = '';
    public name = '';
    public scope = new TenantScope();
}

class OptionalTenantRow {
    public id = '';
    public name = '';
    public scope: TenantScope | null = null;
}

class NestedTenantContext extends DbContext {
    public requiredRows = this.set(RequiredTenantRow);
    public optionalRows = this.set(OptionalTenantRow);

    constructor(private readonly crossTenant = false) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        const configured = options.useProvider(
            sqliteProviderServices,
            ':memory:',
        );
        if (this.crossTenant) {
            configured.allowCrossTenantAccess();
        } else {
            configured.useTenantScope(() => new TenantId('tenant-one'));
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RequiredTenantRow, entity => {
            entity.toTable('required_tenant_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.scope.tenantId);
            entity.complexProperty(
                row => row.scope,
                { constructor: TenantScope, required: true },
                scope => scope.property(value => value.tenantId)
                    .hasColumnName('tenant_id').hasColumnType('text')
                    .hasConversion(tenantIdConverter).isRequired(),
            );
        });
        model.entity(OptionalTenantRow, entity => {
            entity.toTable('optional_tenant_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.scope.tenantId);
            entity.complexProperty(
                row => row.scope,
                { constructor: TenantScope },
                scope => scope.property(value => value.tenantId)
                    .hasColumnName('tenant_id').hasColumnType('text')
                    .hasConversion(tenantIdConverter),
            );
        });
    }
}

async function open(crossTenant = false): Promise<NestedTenantContext> {
    const db = NestedTenantContext.create(crossTenant);
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    for (const table of ['required_tenant_rows', 'optional_tenant_rows']) {
        await db.database.connection.query({
            text: `insert into ${table} (id, name, tenant_id) values (?, ?, ?)`,
            values: ['row-one', 'before', 'tenant-one'],
        });
    }
    return db;
}

describe('nested tenant set updates', () => {
    it('rejects a converted tenant assignment beside business fields', async () => {
        const db = await open();
        try {
            await expect(db.requiredRows
                .where(row => row.id.eq('row-one'))
                .executeUpdate({
                    name: 'moved',
                    scope: { tenantId: new TenantId('tenant-two') },
                }))
                .rejects.toBeInstanceOf(TenantOwnershipError);

            const rows = await db.database.connection.query<{
                name: string;
                tenant_id: string;
            }>({
                text: 'select name, tenant_id from required_tenant_rows',
                values: [],
            });
            expect(rows.rows).toEqual([{
                name: 'before',
                tenant_id: 'tenant-one',
            }]);
        } finally {
            await db.dispose();
        }
    });

    it('rejects an optional nested assignment from an untyped caller', async () => {
        const db = await open();
        try {
            const javascriptValues: unknown = {
                scope: { tenantId: new TenantId('tenant-two') },
            };
            await expect(db.optionalRows
                .where(row => row.id.eq('row-one'))
                .executeUpdate(javascriptValues as never))
                .rejects.toBeInstanceOf(TenantOwnershipError);
        } finally {
            await db.dispose();
        }
    });

    it('allows the same resolved assignment with cross-tenant access', async () => {
        const db = await open(true);
        try {
            await expect(db.requiredRows
                .where(row => row.id.eq('row-one'))
                .executeUpdate({
                    name: 'moved',
                    scope: { tenantId: new TenantId('tenant-two') },
                }))
                .resolves.toBe(1);

            const rows = await db.database.connection.query<{
                name: string;
                tenant_id: string;
            }>({
                text: 'select name, tenant_id from required_tenant_rows',
                values: [],
            });
            expect(rows.rows).toEqual([{
                name: 'moved',
                tenant_id: 'tenant-two',
            }]);
        } finally {
            await db.dispose();
        }
    });
});
