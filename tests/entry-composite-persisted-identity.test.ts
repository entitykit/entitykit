import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class CompositeIdentityRow {
    public tenant = '';
    public code = '';
    public name = '';
}

class CompositeIdentityContext extends DbContext {
    public rows = this.set(CompositeIdentityRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CompositeIdentityRow, entity => {
            entity.toTable('composite_identity_rows');
            entity.hasKey(row => [row.tenant, row.code]);
            entity.property(row => row.tenant).hasColumnType('text').isRequired();
            entity.property(row => row.code).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

describe('composite entry persisted identity', () => {
    it('reloads by every original key part after live mutations', async () => {
        const db = CompositeIdentityContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: `insert into composite_identity_rows (tenant, code, name)
                values (?, ?, ?), (?, ?, ?)`,
            values: [
                'tenant-1', 'row-1', 'first',
                'tenant-2', 'row-2', 'second',
            ],
        });
        const row = requireDefined(await db.rows.find('tenant-1', 'row-1'));
        const entry = requireDefined(db.entry(row));
        row.tenant = 'tenant-2';
        row.code = 'row-2';

        const values = requireDefined(await entry.getDatabaseValues());
        expect(values.toObject()).toEqual({
            tenant: 'tenant-1',
            code: 'row-1',
            name: 'first',
        });
        await expect(entry.reload()).resolves.toBe(true);

        expect(row).toMatchObject({
            tenant: 'tenant-1',
            code: 'row-1',
            name: 'first',
        });
        expect(await db.rows.find('tenant-1', 'row-1')).toBe(row);
        const second = requireDefined(await db.rows.find('tenant-2', 'row-2'));
        expect(second).not.toBe(row);
        expect(second.name).toBe('second');
        expect(db.changeTracker.entries()).toHaveLength(2);
        await db.dispose();
    });
});
