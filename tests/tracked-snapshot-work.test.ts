import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import * as initialSnapshot from '../packages/core/src/tracking/initial-tracked-entry-snapshot';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { cloneBoundValues } from '../packages/core/src/tracking/bound-value-snapshot';

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

    it('uses no tracking snapshots for 1000 buffered no-tracking rows and retains attachment facts', async () => {
        const db = SnapshotContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({
                text: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < 1000)
                    insert into snapshot_rows select n, '{"nested":{"label":"original"}}' from numbers`,
                values: [],
            });
            const snapshots = jest.spyOn(initialSnapshot, 'captureInitialTrackedEntrySnapshot');
            const tracked = jest.spyOn(ChangeTracker.prototype, 'track');
            fromProvider.mockClear();
            const rows = await db.rows.asNoTracking().toArray();
            expect(rows).toHaveLength(1000);
            expect(tracked).not.toHaveBeenCalled();
            expect(snapshots).not.toHaveBeenCalled();
            expect(fromProvider).toHaveBeenCalledTimes(2000);
            expect(db.changeTracker.entries()).toEqual([]);
            const row = rows[0];
            db.rows.attach(row);
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

describe('bound snapshot copies', () => {
    it('owns a separate cyclic graph for each bound property', () => {
        const value: { label: string; self?: unknown } = { label: 'before' };
        value.self = value;
        const original = { first: value, second: value };
        const copy = cloneBoundValues(original) as typeof original;
        expect(copy.first).not.toBe(value);
        expect(copy.second).not.toBe(copy.first);
        expect(copy.first.self).toBe(copy.first);
        expect(copy.second.self).toBe(copy.second);
        copy.first.label = 'after';
        expect(value.label).toBe('before');
        expect(copy.second.label).toBe('before');
    });

    it('captures root getters before cloning any nested value', () => {
        const events: string[] = [];
        let later = 'before';
        const nested = {
            get value(): number {
                events.push('nested');
                later = 'after';
                return 42;
            },
        };
        const values = {
            get first(): object {
                events.push('first');
                return nested;
            },
            get second(): string {
                events.push('second');
                return later;
            },
        };
        expect(cloneBoundValues(values)).toEqual({ first: { value: 42 }, second: 'before' });
        expect(events).toEqual(['first', 'second', 'nested']);
        expect(later).toBe('after');
    });

    it('copies special own keys without changing the output prototype', () => {
        const values = Object.create({ inherited: true }) as Record<PropertyKey, unknown>;
        Object.defineProperty(values, '__proto__', { enumerable: true, value: { owned: true } });
        Object.defineProperty(values, 'hidden', { value: true });
        Object.defineProperty(values, 'constructor', { enumerable: true, value: 'own constructor' });
        values[Symbol('symbol')] = true;
        const copy = cloneBoundValues(values);
        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect(Object.keys(copy)).toEqual(['__proto__', 'constructor']);
        expect(Object.prototype.hasOwnProperty.call(copy, '__proto__')).toBe(true);
        expect(copy.__proto__).toEqual({ owned: true });
        expect(copy.__proto__).not.toBe(values.__proto__);
        expect(copy.constructor).toBe('own constructor');
    });
});
