import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, valueConverter } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

let providerKey = 'one';

const driftingKey = valueConverter<string, string>({
    toProvider: () => providerKey,
    fromProvider: () => 'logical',
});

class ConvertedIdentityRow {
    public id = 'logical';
    public name = '';
}

class ConvertedIdentityContext extends DbContext {
    public rows = this.set(ConvertedIdentityRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ConvertedIdentityRow, entity => {
            entity.toTable('converted_identity_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(driftingKey).isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

async function openIdentityContext(): Promise<ConvertedIdentityContext> {
    providerKey = 'one';
    const db = ConvertedIdentityContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: `insert into converted_identity_rows (id, name)
            values (?, ?), (?, ?)`,
        values: ['one', 'row-one', 'two', 'row-two'],
    });
    return db;
}

let providerTenant = 'tenant-one';

const driftingTenant = valueConverter<string, string>({
    toProvider: () => providerTenant,
    fromProvider: () => 'scope',
});

class OriginalTenantRow {
    public id = '';
    public tenantId = 'scope';
    public name = '';
}

class OriginalTenantContext extends DbContext {
    public rows = this.set(OriginalTenantRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'scope');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(OriginalTenantRow, entity => {
            entity.toTable('original_tenant_rows');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(driftingTenant)
                .isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

describe('tracked provider identity facts', () => {
    it('updates the provider key captured from a materialized row', async () => {
        const db = await openIdentityContext();
        const row = await db.rows.find('logical');
        if (!row) throw new Error('Expected the converted row to load.');
        providerKey = 'two';
        row.name = 'changed';

        await expect(db.saveChanges()).resolves.toBe(1);

        const stored = await db.database.connection.query<{
            id: string;
            name: string;
        }>({
            text: 'select id, name from converted_identity_rows order by id',
            values: [],
        });
        expect(stored.rows).toEqual([
            { id: 'one', name: 'changed' },
            { id: 'two', name: 'row-two' },
        ]);
        await db.dispose();
    });

    it('updates the provider key registered when the entity was attached', async () => {
        const db = await openIdentityContext();
        const row = Object.assign(new ConvertedIdentityRow(), {
            name: 'row-one',
        });
        db.rows.attach(row);
        providerKey = 'two';
        row.name = 'changed';

        await expect(db.saveChanges()).resolves.toBe(1);

        const stored = await db.database.connection.query<{
            id: string;
            name: string;
        }>({
            text: 'select id, name from converted_identity_rows order by id',
            values: [],
        });
        expect(stored.rows).toEqual([
            { id: 'one', name: 'changed' },
            { id: 'two', name: 'row-two' },
        ]);
        await db.dispose();
    });

    it('deletes the provider key registered when the entity was attached', async () => {
        const db = await openIdentityContext();
        const row = Object.assign(new ConvertedIdentityRow(), {
            name: 'row-one',
        });
        db.rows.attach(row);
        providerKey = 'two';
        db.rows.remove(row);

        await expect(db.saveChanges()).resolves.toBe(1);

        const stored = await db.database.connection.query<{
            id: string;
            name: string;
        }>({
            text: 'select id, name from converted_identity_rows order by id',
            values: [],
        });
        expect(stored.rows).toEqual([{ id: 'two', name: 'row-two' }]);
        await db.dispose();
    });

    it('rejects an original tenant fact that drifted from its tracked provider value', async () => {
        providerTenant = 'tenant-one';
        const db = OriginalTenantContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: `insert into original_tenant_rows (id, tenant_id, name)
                values (?, ?, ?)`,
            values: ['row', 'tenant-one', 'before'],
        });
        const row = Object.assign(new OriginalTenantRow(), {
            id: 'row',
            name: 'before',
        });
        db.rows.attach(row);
        await db.database.connection.query({
            text: 'update original_tenant_rows set tenant_id = ? where id = ?',
            values: ['tenant-two', 'row'],
        });
        providerTenant = 'tenant-two';
        row.name = 'changed-by-stale-context';

        await expect(db.saveChanges()).rejects.toThrow(
            'original tenant key \'tenantId\' must match the current tenant scope',
        );

        const stored = await db.database.connection.query<{
            tenant_id: string;
            name: string;
        }>({
            text: 'select tenant_id, name from original_tenant_rows where id = ?',
            values: ['row'],
        });
        expect(stored.rows).toEqual([{
            tenant_id: 'tenant-two',
            name: 'before',
        }]);
        await db.dispose();
    });
});
