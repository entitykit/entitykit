import { DbContext, EntityState, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import { GeneratedValueRecorder } from '../packages/core/src/core/unit-of-work/generated-value-recorder';
import type { AppliedGeneratedValue } from '../packages/core/src/core/unit-of-work/applied-generated-value';
import { TrackedSaveState } from '../packages/core/src/core/unit-of-work/tracked-save-state';
import type { SavePlanEntry } from '../packages/core/src/core/save-plan';
import { registerSavePlanExecution, savePlanExecution } from '../packages/core/src/core/save-plan-execution';
import { captureManualAcceptanceSnapshot } from '../packages/core/src/tracking/persisted-entry-snapshot';
import type { EntityEntry } from '../packages/core/src/tracking/entity-entry';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { internalChangeTracker, internalEntityEntry } from './support/public-api-internals';

class SavedRow {
    public id = 0; public label = ''; public category = '';
}
class SaveScalingContext extends DbContext {
    public rows = this.set(SavedRow);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(SavedRow, entity => {
            entity.toTable('save_scaling_rows'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired().useSqliteRowId();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.category).hasColumnType('text').isRequired();
        });
    }
}

interface SaveStateMerge { mergeGeneratedValues: (
    plan: readonly SavePlanEntry[], values: readonly AppliedGeneratedValue[],
) => void }

describe('save bookkeeping scaling', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([100, 200, 400])('uses linear generated-value lookup and snapshot merge work for %i inserts', async count => {
        const db = SaveScalingContext.create();
        try {
            await db.database.ensureCreated();
            let ledgerReads = 0;
            let snapshotReads = 0;
            // eslint-disable-next-line @typescript-eslint/unbound-method -- The wrapper calls it with the original recorder receiver.
            const recordApplied = GeneratedValueRecorder.prototype.recordApplied;
            jest.spyOn(GeneratedValueRecorder.prototype, 'recordApplied').mockImplementation(function (
                this: GeneratedValueRecorder, entry, values,
            ): void {
                const ledger = (this as unknown as { values: AppliedGeneratedValue[] }).values;
                const start = ledger.length;
                recordApplied.call(this, entry, values);
                for (const record of ledger.slice(start)) {
                    const owner = record.entry;
                    Object.defineProperty(record, 'entry', {
                        get: () => {
                            ledgerReads++; return owner;
                        },
                    });
                }
            });
            const state = TrackedSaveState.prototype as unknown as SaveStateMerge;
            const merge = state.mergeGeneratedValues;
            jest.spyOn(state, 'mergeGeneratedValues').mockImplementation(function (
                this: SaveStateMerge, plan, generated,
            ): void {
                for (const item of plan) {
                    for (const snapshot of savePlanExecution(item)?.persistedEntries ?? []) {
                        const owner = snapshot.entry;
                        Object.defineProperty(snapshot, 'entry', {
                            get: () => {
                                snapshotReads++; return owner;
                            },
                        });
                    }
                }
                merge.call(this, plan, generated);
            });
            const rows = Array.from({ length: count }, (_, index) => Object.assign(new SavedRow(), {
                label: `row ${String(index)}`, category: 'generated',
            }));
            for (const row of rows) db.rows.add(row);
            await expect(db.saveChanges()).resolves.toBe(count);
            expect(ledgerReads).toBeLessThanOrEqual(8 * count);
            expect(snapshotReads).toBeLessThanOrEqual(24 * count);
            expect(new Set(rows.map(row => row.id)).size).toBe(count);
            expect(rows.every(row => row.id > 0 && db.entry(row)?.state === EntityState.Unchanged)).toBe(true);
            expect(db.changeTracker.entries()).toHaveLength(count);
            expect(await db.rows.count()).toBe(count);
            db.changeTracker.clear();
            const stored = await db.rows.asNoTracking().toArray();
            expect(stored.map(row => row.id).sort((a, b) => a - b)).toEqual(rows.map(row => row.id).sort((a, b) => a - b));
            expect(stored.every(row => row.category === 'generated')).toBe(true);
        } finally {
            await db.dispose();
        }
    });

    it('retains ordered records, latest values, defensive bound copies, and entry-specific lifetimes', async () => {
        const db = SaveScalingContext.create();
        try {
            const row = new SavedRow();
            const entry = internalEntityEntry(db.rows.add(row)) as unknown as EntityEntry<object>;
            const recorder = new GeneratedValueRecorder(internalChangeTracker(db.changeTracker));
            const original = new Uint8Array([1, 2]);
            recorder.recordApplied(entry, [{ propertyName: 'label', persistedValue: 'first', boundValue: original }]);
            original[0] = 9;
            const found = recorder.find(row, 'label');
            expect(found).toEqual({ propertyName: 'label', persistedValue: 'first', boundValue: new Uint8Array([1, 2]) });
            (found?.boundValue as Uint8Array)[1] = 9;
            expect(recorder.find(row, 'label')?.boundValue).toEqual(new Uint8Array([1, 2]));
            recorder.record(row, [{ propertyName: 'label', persistedValue: 'latest', boundValue: 'latest' }], { label: '' });
            expect(recorder.rollbackSources()).toHaveLength(1);
            expect(recorder.find(row, 'label')?.persistedValue).toBe('latest');
            expect(recorder.find(row, 'missing')).toBeUndefined();
            db.rows.detach(row);
            expect(recorder.find(row, 'label')).toBeUndefined();
            const replacement = internalEntityEntry(db.rows.add(row)) as unknown as EntityEntry<object>;
            expect(replacement).not.toBe(entry);
            expect(recorder.find(row, 'label')).toBeUndefined();
            recorder.recordApplied(replacement, [{ propertyName: 'label', persistedValue: 'new entry', boundValue: 'new entry' }]);
            expect(recorder.find(row, 'label')?.persistedValue).toBe('new entry');
            expect(recorder.take().map(value => [value.entry, value.persistedValue])).toEqual([
                [entry, 'first'], [entry, 'latest'], [replacement, 'new entry'],
            ]);
            expect(recorder.rollbackSources()).toEqual([]);
            expect(recorder.find(row, 'label')).toBeUndefined();
            expect(recorder.take()).toEqual([]);
            expect(() => recorder.register(new SavedRow(), [], {}))
                .toThrow('Generated values require their entity to remain tracked.');
        } finally {
            await db.dispose();
        }
    });

    it('merges latest generated facts into the first matching snapshot and ignores unmatched entries', async () => {
        const db = SaveScalingContext.create();
        try {
            const row = new SavedRow();
            const entry = internalEntityEntry(db.rows.add(row)) as unknown as EntityEntry<object>;
            const other = internalEntityEntry(db.rows.add(new SavedRow())) as unknown as EntityEntry<object>;
            const first = captureManualAcceptanceSnapshot(entry);
            const duplicate = captureManualAcceptanceSnapshot(entry);
            const plan = [0, 1, 2].map((): SavePlanEntry => ({
                entity: row, entityName: 'SavedRow', keyValue: 0, state: EntityState.Added,
                statement: { text: 'insert', values: [] },
            }));
            registerSavePlanExecution(plan[0], { persistedEntries: [first] });
            registerSavePlanExecution(plan[1], { persistedEntries: [duplicate] });
            const state = Object.create(TrackedSaveState.prototype) as SaveStateMerge;
            state.mergeGeneratedValues(plan, [
                { entry, propertyName: 'id', persistedValue: 10, boundValue: 10 },
                { entry: other, propertyName: 'id', persistedValue: 99, boundValue: 99 },
                { entry, propertyName: 'id', persistedValue: 20, boundValue: 20 },
            ]);
            expect(first.values.id).toBe(20);
            expect(first.boundValues.id).toBe(20);
            expect(duplicate.values.id).toBe(0);
            expect(duplicate.boundValues.id).toBe(0);
        } finally {
            await db.dispose();
        }
    });
});
