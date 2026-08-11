import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

let keyFacts: string[] = [];
let keyFallback = 'one';
let keyConversions = 0;

const driftingKey = valueConverter<string, string>({
    toProvider: () => {
        keyConversions += 1;
        return keyFacts.shift() ?? keyFallback;
    },
    fromProvider: () => 'logical',
});

class BoundFindRow {
    public id = 'logical';
    public name = '';
}

class BoundFindContext extends DbContext {
    public rows = this.set(BoundFindRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BoundFindRow, entity => {
            entity.toTable('bound_find_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(driftingKey).isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

let tenantFacts: string[] = [];
let tenantConversions = 0;

const driftingTenant = valueConverter<string, string>({
    toProvider: () => {
        tenantConversions += 1;
        return tenantFacts.shift() ?? 'tenant-one';
    },
    fromProvider: () => 'scope',
});

class BoundTenantRow {
    public id = '';
    public tenantId = 'scope';
    public name = '';
}

class BoundTenantContext extends DbContext {
    public rows = this.set(BoundTenantRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'scope');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BoundTenantRow, entity => {
            entity.toTable('bound_tenant_rows');
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

describe('find bound provider facts', () => {
    it('uses one converted key for identity lookup and SQL', async () => {
        keyFacts = ['one', 'two'];
        keyConversions = 0;
        const db = BoundFindContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        await db.database.connection.query({
            text: `insert into bound_find_rows (id, name)
                values (?, ?), (?, ?)`,
            values: ['one', 'row-one', 'two', 'row-two'],
        });
        keyFacts = ['one', 'two'];
        keyConversions = 0;

        await expect(db.rows.find('logical')).resolves.toMatchObject({
            name: 'row-one',
        });
        expect(keyConversions).toBe(1);
        await db.dispose();
    });

    it('reloads with the originally bound key after converter drift', async () => {
        keyFallback = 'one';
        keyFacts = [];
        const db = BoundFindContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        await db.database.connection.query({
            text: `insert into bound_find_rows (id, name)
                values (?, ?), (?, ?)`,
            values: ['one', 'row-one', 'two', 'row-two'],
        });
        const row = Object.assign(new BoundFindRow(), { name: 'attached' });
        const entry = db.rows.attach(row);
        keyFallback = 'two';

        await expect(entry.reload()).resolves.toBe(true);
        expect(row.name).toBe('row-one');
        await db.dispose();
    });

    it('reads database values with the originally bound key', async () => {
        keyFallback = 'one';
        keyFacts = [];
        const db = BoundFindContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        await db.database.connection.query({
            text: `insert into bound_find_rows (id, name)
                values (?, ?), (?, ?)`,
            values: ['one', 'row-one', 'two', 'row-two'],
        });
        const row = Object.assign(new BoundFindRow(), { name: 'attached' });
        const entry = db.rows.attach(row);
        keyFallback = 'two';
        keyConversions = 0;

        const values = await entry.getDatabaseValues();

        expect(values?.get('name')).toBe('row-one');
        expect(row.name).toBe('attached');
        expect(keyConversions).toBe(0);
        await db.dispose();
    });

    it('uses one converted tenant for tracked lookup and SQL filtering', async () => {
        tenantFacts = ['tenant-one', 'tenant-two'];
        tenantConversions = 0;
        const db = BoundTenantContext.create();
        await db.database.connection.query({
            text: `create table bound_tenant_rows (
                id text not null,
                tenant_id text not null,
                name text not null,
                primary key (tenant_id, id)
            )`,
            values: [],
        });
        await db.database.connection.query({
            text: `insert into bound_tenant_rows (id, tenant_id, name)
                values (?, ?, ?), (?, ?, ?)`,
            values: [
                'shared', 'tenant-one', 'row-one',
                'shared', 'tenant-two', 'row-two',
            ],
        });
        tenantFacts = ['tenant-one', 'tenant-two'];
        tenantConversions = 0;

        const row = requireDefined(await db.rows.find('shared'));
        expect(row.name).toBe('row-one');
        expect(tenantConversions).toBe(1);
        await db.dispose();
    });

    it('reuses one tenant fact while reading tracked database values', async () => {
        tenantFacts = [];
        const db = BoundTenantContext.create();
        await db.database.connection.query({
            text: `create table bound_tenant_rows (
                id text not null,
                tenant_id text not null,
                name text not null,
                primary key (tenant_id, id)
            )`,
            values: [],
        });
        await db.database.connection.query({
            text: `insert into bound_tenant_rows (id, tenant_id, name)
                values (?, ?, ?), (?, ?, ?)`,
            values: [
                'shared', 'tenant-one', 'row-one',
                'shared', 'tenant-two', 'row-two',
            ],
        });
        const row = Object.assign(new BoundTenantRow(), {
            id: 'shared', name: 'attached',
        });
        const entry = db.rows.attach(row);
        tenantFacts = ['tenant-one', 'tenant-two'];
        tenantConversions = 0;

        const values = await entry.getDatabaseValues();

        expect(values?.get('name')).toBe('row-one');
        expect(tenantConversions).toBe(1);
        await db.dispose();
    });
});
