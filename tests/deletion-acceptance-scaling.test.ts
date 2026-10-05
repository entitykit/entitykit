import { DbContext, EntityState, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { ChangeTrackerRegistry } from '../packages/core/src/tracking/change-tracker-registry';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { RestorationScope } from '../packages/core/src/restoration-scope';
import { captureManualAcceptanceSnapshot } from '../packages/core/src/tracking/persisted-entry-snapshot';
import { internalChangeTracker } from './support/public-api-internals';

class DeletedRow {
    public id = 0; public label = '';
}
class DeletionContext extends DbContext {
    public rows = this.set(DeletedRow);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(DeletedRow, entity => {
            entity.toTable('deletion_rows'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

async function pendingDeletes(count: number): Promise<{ db: DeletionContext; rows: DeletedRow[] }> {
    const db = DeletionContext.create();
    await db.database.ensureCreated();
    await db.database.connection.query({
        text: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?)
            insert into deletion_rows select n, 'delete' from numbers`,
        values: [count + 1],
    });
    const rows = await db.rows.orderBy(row => row.id).toArray();
    for (const row of rows.slice(0, count)) db.rows.remove(row);
    return { db, rows };
}

describe('bulk deletion acceptance work', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([100, 200, 400])('validates a completed %i-row deletion once without scanning stable detachment targets', async count => {
        const { db, rows } = await pendingDeletes(count);
        try {
            let invariantSlots = 0;
            let entrySlots = 0;
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Both wrappers call with the original registry or tracker receiver.
            const assertInvariant = ChangeTrackerRegistry.prototype.assertInvariant;
            const invariant = jest.spyOn(ChangeTrackerRegistry.prototype, 'assertInvariant').mockImplementation(function (
                this: ChangeTrackerRegistry,
            ): void {
                invariantSlots += this.entries().length;
                assertInvariant.call(this);
            });
            // eslint-disable-next-line @typescript-eslint/unbound-method -- Preserve the active tracker receiver.
            const entries = ChangeTracker.prototype.entries;
            jest.spyOn(ChangeTracker.prototype, 'entries').mockImplementation(function (this: ChangeTracker): ReturnType<ChangeTracker['entries']> {
                const result = entries.call(this); entrySlots += result.length; return result;
            });
            await expect(db.saveChanges()).resolves.toBe(count);
            expect(invariant).toHaveBeenCalledTimes(1);
            expect(invariantSlots).toBeLessThanOrEqual(5 * (count + 1));
            expect(entrySlots).toBeLessThanOrEqual(12 * (count + 1));
            for (const row of rows.slice(0, count)) expect(db.entry(row)).toBeUndefined();
            expect(db.changeTracker.entries().map(entry => entry.entity)).toEqual([rows[count]]);
            expect(db.entry(rows[count])?.state).toBe(EntityState.Unchanged);
            expect(await db.rows.count()).toBe(1);
        } finally {
            await db.dispose();
        }
    });

    it('restores every accepted deletion and identity after a partial acceptance failure, then retries', async () => {
        const { db, rows } = await pendingDeletes(30);
        try {
            let accepted = 0;
            const failure = new Error('acceptance interrupted');
            // eslint-disable-next-line @typescript-eslint/unbound-method -- The wrapper preserves the actual registry receiver.
            const detach = ChangeTrackerRegistry.prototype.detachForAcceptance;
            const interrupted = jest.spyOn(ChangeTrackerRegistry.prototype, 'detachForAcceptance')
                .mockImplementation(function (this: ChangeTrackerRegistry, entity) {
                    if (++accepted === 2) throw failure;
                    return detach.call(this, entity);
                });
            await expect(db.saveChanges()).rejects.toBe(failure);
            interrupted.mockRestore();
            expect(db.changeTracker.entries()).toHaveLength(31);
            for (const row of rows.slice(0, 30)) {
                expect(db.entry(row)?.state).toBe(EntityState.Deleted);
                expect(db.entry(row)?.originalValues.id).toBe(row.id);
            }
            expect(db.entry(rows[30])?.state).toBe(EntityState.Unchanged);
            expect(await db.rows.count()).toBe(31);
            await expect(db.saveChanges()).resolves.toBe(30);
            expect(db.changeTracker.entries().map(entry => entry.entity)).toEqual([rows[30]]);
            expect(await db.rows.count()).toBe(1);
        } finally {
            await db.dispose();
        }
    });
    it('keeps the immediate invariant boundary for individual detaches', async () => {
        const { db, rows } = await pendingDeletes(0);
        try {
            const invariant = jest.spyOn(ChangeTrackerRegistry.prototype, 'assertInvariant');
            expect(db.rows.detach(rows[0])?.state).toBe(EntityState.Detached);
            expect(invariant).toHaveBeenCalledTimes(1);
            expect(db.rows.detach(rows[0])).toBeUndefined();
            expect(invariant).toHaveBeenCalledTimes(1);
            expect(db.changeTracker.entries()).toEqual([]);
            expect(await db.rows.count()).toBe(1);
        } finally {
            await db.dispose();
        }
    });
    it('restores detached entries when the containing transaction rolls back', async () => {
        const { db, rows } = await pendingDeletes(30);
        try {
            const failure = new Error('caller rolls back');
            await expect(db.transaction(async transaction => {
                await expect(transaction.saveChanges()).resolves.toBe(30);
                expect(transaction.changeTracker.entries().map(entry => entry.entity)).toEqual([rows[30]]);
                expect(await transaction.rows.count()).toBe(1);
                expect(() => transaction.rows.attach(Object.assign(new DeletedRow(), { id: 1 })))
                    .toThrow();
                throw failure;
            })).rejects.toBe(failure);
            expect(db.changeTracker.entries()).toHaveLength(31);
            for (const row of rows.slice(0, 30)) expect(db.entry(row)?.state).toBe(EntityState.Deleted);
            expect(await db.rows.count()).toBe(31);
            await expect(db.saveChanges()).resolves.toBe(30);
            expect(await db.rows.count()).toBe(1);
        } finally {
            await db.dispose();
        }
    });
    it('restores registry membership through an isolated acceptance receipt', async () => {
        const { db, rows } = await pendingDeletes(30);
        try {
            const tracker = internalChangeTracker(db.changeTracker);
            const snapshots = tracker.entries().filter(entry => entry.state === EntityState.Deleted)
                .map(captureManualAcceptanceSnapshot);
            const receipt = tracker.acceptPersistedChanges(snapshots, new RestorationScope(() => undefined));
            expect(tracker.entries().map(entry => entry.entity)).toEqual([rows[30]]);
            receipt.rollback();
            expect(tracker.entries()).toHaveLength(31);
            for (const row of rows.slice(0, 30)) expect(db.entry(row)?.state).toBe(EntityState.Deleted);
            expect(await db.rows.count()).toBe(31);
        } finally {
            await db.dispose();
        }
    });
});
