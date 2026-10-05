import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import * as initialSnapshot from '../packages/core/src/tracking/initial-tracked-entry-snapshot';

class SnapshotRow {
    public id = 0;
    public payload = { nested: { label: '' } };
}

const fromProvider = jest.fn((value: string): SnapshotRow['payload'] =>
    JSON.parse(value) as SnapshotRow['payload']);

class SnapshotContext extends DbContext {
    public rows = this.set(SnapshotRow);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(SnapshotRow, entity => {
            entity.toTable('snapshot_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.payload).hasColumnType('text').isRequired()
                .hasConversion({
                    toProvider: value => JSON.stringify(value),
                    fromProvider,
                });
        });
    }
}

describe('initial tracked snapshot work', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([100, 500, 1000])('captures one owned snapshot for each of %i tracked rows', async count => {
        const db = SnapshotContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({
                text: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?)
                    insert into snapshot_rows select n, '{"nested":{"label":"original"}}' from numbers`,
                values: [count],
            });
            const snapshots = jest.spyOn(initialSnapshot, 'captureInitialTrackedEntrySnapshot');
            fromProvider.mockClear();
            const rows = await db.rows.toArray();
            expect(rows).toHaveLength(count);
            expect(snapshots).toHaveBeenCalledTimes(count);
            expect(fromProvider).toHaveBeenCalledTimes(3 * count);
            expect(db.changeTracker.entries()).toHaveLength(count);
            const row = rows[0];
            row.payload.nested.label = 'changed';
            db.changeTracker.detectChanges();
            expect(db.entry(row)?.state).toBe(EntityState.Modified);
            expect(db.entry(row)?.originalValues.payload).toEqual({ nested: { label: 'original' } });
            await expect(db.saveChanges()).resolves.toBe(1);
            db.changeTracker.clear();
            await expect(db.rows.find(row.id)).resolves.toMatchObject({
                payload: { nested: { label: 'changed' } },
            });
        } finally {
            await db.dispose();
        }
    });
});
