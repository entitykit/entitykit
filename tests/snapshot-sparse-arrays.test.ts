import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { restorePropertyValue } from '../packages/core/src/property-value-restoration';
import { writeVerifiedProperty } from '../packages/core/src/verified-property-write';
import { cloneSnapshotValue } from '../packages/core/src/tracking/snapshot-value-clone';
import { snapshotValuesEqual } from '../packages/core/src/tracking/snapshot-value-equality';
import { SparseArrayContext, SparseArrayRow, seedSparseArrayRows } from './support/sparse-array-support';

describe('sparse snapshot arrays', () => {
    it.each([0, 1, 2])('compares missing slot %s against an actual value symmetrically', index => {
        const dense = ['first', 'middle', 'last'];
        const sparse = dense.slice();
        Reflect.deleteProperty(sparse, index);
        expect(snapshotValuesEqual(sparse, dense)).toBe(false);
        expect(snapshotValuesEqual(dense, sparse)).toBe(false);
        expect(snapshotValuesEqual({ nested: sparse }, { nested: dense })).toBe(false);
        expect(snapshotValuesEqual(new Map([['items', sparse]]), new Map([['items', dense]]))).toBe(false);
    });

    it('keeps hole and undefined value semantics compatible with independent snapshots', () => {
        const sparse: unknown[] = [];
        sparse.length = 3;
        sparse[1] = { label: 'middle' };
        const copy = cloneSnapshotValue(sparse);
        expect(snapshotValuesEqual(sparse, copy)).toBe(true);
        expect(snapshotValuesEqual(copy, sparse)).toBe(true);
        expect(snapshotValuesEqual(sparse, [undefined, { label: 'middle' }, undefined])).toBe(true);
    });

    it('terminates on sparse cyclic arrays and detects an occupied slot changing', () => {
        const left: unknown[] = [];
        const right: unknown[] = [];
        left.length = right.length = 2;
        left[1] = left;
        right[1] = right;
        expect(snapshotValuesEqual(left, right)).toBe(true);
        right[0] = 'filled';
        expect(snapshotValuesEqual(left, right)).toBe(false);
        expect(snapshotValuesEqual(right, left)).toBe(false);
    });

    it.each([0, 1, 2])('refuses assignment and restoration when the setter deletes slot %s', index => {
        const row = new SparseArrayRow(index);
        const metadata = new ModelBuilder().entity(SparseArrayRow, entity => {
            entity.toTable('sparse_array_rows');
            entity.hasKey(value => value.id);
            entity.property(value => value.id).hasColumnType('text');
            entity.property(value => value.items).hasColumnType('json');
        }).build().getEntity(SparseArrayRow);
        const property = metadata.getProperty('items');
        const expected = ['first', 'middle', 'last'];
        expect(() => writeVerifiedProperty(row, property, expected, 'SparseArrayRow.items'))
            .toThrow('Property \'SparseArrayRow.items\' refused its assigned value.');
        expect(() => {
            restorePropertyValue(row, property, expected, cloneSnapshotValue(expected), 'SparseArrayRow.items');
        })
            .toThrow('Property \'SparseArrayRow.items\' refused its restoration value.');
        expect(index in row.items).toBe(false);
        expect(expected).toEqual(['first', 'middle', 'last']);
    });

    it.each([0, 1, 2].flatMap(index => ['tracked', 'untracked', 'stream'].map(route => ({ index, route }))))(
        'refuses a deleted slot $index during actual $route materialization without retaining the refused row', async ({ index, route }) => {
            const context = SparseArrayContext.create(index);
            try {
                await seedSparseArrayRows(context);
                const rows = context.rows.orderBy(row => row.id);
                if (route === 'stream') {
                    const stream = rows.stream()[Symbol.asyncIterator]();
                    try {
                        expect(await stream.next()).toMatchObject({ done: false, value: { id: 'a-safe' } });
                        await expect(stream.next()).rejects.toThrow('SparseArrayRow.items');
                    } finally {
                        await stream.return?.();
                    }
                } else {
                    const query = route === 'untracked' ? rows.asNoTracking() : rows;
                    await expect(query.toArray()).rejects.toThrow('SparseArrayRow.items');
                }
                expect(context.changeTracker.entries().map(entry => entry.keyValue)).toEqual(route === 'untracked' ? [] : ['a-safe']);
                expect((await context.database.connection.query({ text: 'select items from sparse_array_rows where id = ?', values: ['b-refused'] })).rows)
                    .toEqual([{ items: '["first","middle","last"]' }]);
                expect(await context.rows.count()).toBe(2);
            } finally {
                await context.dispose();
            }
        },
    );

    it('retains complete arrays and ordinary tracking when the setter accepts every value', async () => {
        const context = SparseArrayContext.create();
        try {
            await seedSparseArrayRows(context);
            const rows = await context.rows.orderBy(row => row.id).toArray();
            expect(rows.map(row => row.items)).toEqual([[], ['first', 'middle', 'last']]);
            expect(context.changeTracker.entries()).toHaveLength(2);
        } finally {
            await context.dispose();
        }
    });
});
