import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class PersistedIdentityRow {
    public id = 0;
    public name = '';
}

class PersistedIdentityContext extends DbContext {
    public rows = this.set(PersistedIdentityRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(PersistedIdentityRow, entity => {
            entity.toTable('persisted_identity_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

describe('entry persisted identity', () => {
    it('reads and reloads the original row after a live key mutation', async () => {
        const db = PersistedIdentityContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: `insert into persisted_identity_rows (id, name)
                values (?, ?), (?, ?)`,
            values: [1, 'one', 2, 'two'],
        });
        const row = requireDefined(await db.rows.find(1));
        const entry = requireDefined(db.entry(row));
        row.id = 2;

        const values = requireDefined(await entry.getDatabaseValues());
        expect(values.toObject()).toEqual({ id: 1, name: 'one' });
        await expect(entry.reload()).resolves.toBe(true);

        expect(row).toMatchObject({ id: 1, name: 'one' });
        expect(await db.rows.find(1)).toBe(row);
        const second = requireDefined(await db.rows.find(2));
        expect(second).not.toBe(row);
        expect(second.name).toBe('two');
        expect(db.changeTracker.entries()).toHaveLength(2);
        await db.dispose();
    });
});
