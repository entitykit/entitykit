import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class TenantId {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

const tenantIdConverter = valueConverter<TenantId, string>({
    toProvider: value => value.value,
    fromProvider: value => new TenantId(value),
});

class TenantRow {
    public id = '';
    public tenantId!: TenantId;
    public name = '';
}

class ConvertedTenantContext extends DbContext {
    public rows = this.set(TenantRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => new TenantId('acme'));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TenantRow, entity => {
            entity.toTable('tenant_rows');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantIdConverter)
                .isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

describe('converted tenant scope', () => {
    it('accepts fresh model objects with the same provider identity', async () => {
        const db = ConvertedTenantContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const row = Object.assign(new TenantRow(), {
            id: 'row-1',
            name: 'row',
        });

        db.rows.add(row);
        expect(row.tenantId.value).toBe('acme');
        await expect(db.saveChanges()).resolves.toBe(1);

        const result = await db.database.connection.query<{
            tenant_id: string;
        }>({
            text: 'select tenant_id from tenant_rows',
            values: [],
        });
        expect(result.rows).toEqual([{ tenant_id: 'acme' }]);
        expect(db.entry(row)?.originalValues.tenantId)
            .not.toBe(row.tenantId);
        expect(db.entry(row)?.state).toBe(EntityState.Unchanged);
        await db.dispose();
    });

    it('rejects a genuinely different converted tenant identity', async () => {
        const db = ConvertedTenantContext.create();
        const row = Object.assign(new TenantRow(), {
            id: 'row-2',
            tenantId: new TenantId('other'),
            name: 'row',
        });

        expect(() => db.rows.add(row)).toThrow(
            'Entity \'TenantRow\' tenant key \'tenantId\' must match the current tenant scope.',
        );
        expect(db.changeTracker.entries()).toEqual([]);
        await db.dispose();
    });
});
