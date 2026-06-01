import fc from 'fast-check';
import { snapshotValuesEqual } from '../src/tracking/snapshot-value-equality';
import { cloneSnapshotValue } from '../src/tracking/snapshot-value-clone';

describe('snapshot value equality', () => {
    it('uses Object.is semantics for primitives', () => {
        expect(snapshotValuesEqual(Number.NaN, Number.NaN)).toBe(true);
        expect(snapshotValuesEqual(0, -0)).toBe(false);
        expect(snapshotValuesEqual('value', 'value')).toBe(true);
        expect(snapshotValuesEqual('value', 'other')).toBe(false);
        expect(snapshotValuesEqual(null, {})).toBe(false);
    });

    it('compares dates and regular expressions by observable value', () => {
        expect(snapshotValuesEqual(
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2026-01-01T00:00:00.000Z'),
        )).toBe(true);
        expect(snapshotValuesEqual(new Date(0), new Date(1))).toBe(false);
        expect(snapshotValuesEqual(new Date(0), {})).toBe(false);

        const left = /entity/giu;
        const right = /entity/giu;
        left.lastIndex = 2;
        right.lastIndex = 2;
        expect(snapshotValuesEqual(left, right)).toBe(true);
        right.lastIndex = 3;
        expect(snapshotValuesEqual(left, right)).toBe(false);
        expect(snapshotValuesEqual(/entity/giu, /other/giu)).toBe(false);
        expect(snapshotValuesEqual(/entity/giu, /entity/gu)).toBe(false);
        expect(snapshotValuesEqual(left, {})).toBe(false);
    });

    it('compares binary values by type, slice, and bytes', () => {
        const buffer = Uint8Array.from([0, 1, 2, 3]).buffer;

        expect(snapshotValuesEqual(buffer, buffer.slice(0))).toBe(true);
        expect(snapshotValuesEqual(
            new Uint8Array(buffer, 1, 2),
            Uint8Array.from([1, 2]),
        )).toBe(true);
        expect(snapshotValuesEqual(
            new Uint8Array([1, 2]),
            new Uint16Array([513]),
        )).toBe(false);
        expect(snapshotValuesEqual(new Uint8Array([1]), new Uint8Array([2])))
            .toBe(false);
        expect(snapshotValuesEqual(new Uint8Array([1]), new Uint8Array([1, 2])))
            .toBe(false);
        expect(snapshotValuesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])))
            .toBe(false);
        expect(snapshotValuesEqual(
            Uint8Array.from([1]).buffer,
            Uint8Array.from([2]).buffer,
        )).toBe(false);
        expect(snapshotValuesEqual(
            new DataView(Uint8Array.from([1]).buffer),
            new DataView(Uint8Array.from([2]).buffer),
        )).toBe(false);
        expect(snapshotValuesEqual(new Uint8Array([1]), {})).toBe(false);
    });

    it('compares arrays, maps, and sets in deterministic iteration order', () => {
        expect(snapshotValuesEqual([1, { id: 2 }], [1, { id: 2 }])).toBe(true);
        expect(snapshotValuesEqual([1], [1, 2])).toBe(false);
        expect(snapshotValuesEqual(Array(1), Array(2))).toBe(false);
        expect(snapshotValuesEqual([], {})).toBe(false);

        expect(snapshotValuesEqual(
            new Map([[{ id: 1 }, { name: 'A' }]]),
            new Map([[{ id: 1 }, { name: 'A' }]]),
        )).toBe(true);
        expect(snapshotValuesEqual(new Map([[1, 'a']]), new Map([[1, 'b']])))
            .toBe(false);
        expect(snapshotValuesEqual(new Map([[1, 'a']]), new Map())).toBe(false);
        expect(snapshotValuesEqual(new Map(), new Map([[1, 'a']]))).toBe(false);
        expect(snapshotValuesEqual(
            new Map([[1, 'a'], [2, 'b']]),
            new Map([[1, 'a'], [2, 'different']]),
        )).toBe(false);
        expect(snapshotValuesEqual(new Map(), {})).toBe(false);

        expect(snapshotValuesEqual(new Set([{ id: 1 }]), new Set([{ id: 1 }])))
            .toBe(true);
        expect(snapshotValuesEqual(new Set([1, 2]), new Set([2, 1]))).toBe(false);
        expect(snapshotValuesEqual(new Set([1]), new Set())).toBe(false);
        expect(snapshotValuesEqual(new Set(), new Set([1]))).toBe(false);
        expect(snapshotValuesEqual(new Set([1, 2]), new Set([1, 3])))
            .toBe(false);
        expect(snapshotValuesEqual(new Set(), {})).toBe(false);
    });

    it('compares enumerable string and symbol keys while respecting prototypes', () => {
        const key = Symbol('key');
        const left = Object.create(null) as Record<PropertyKey, unknown>;
        const right = Object.create(null) as Record<PropertyKey, unknown>;
        left.value = 1;
        left[key] = { nested: true };
        right.value = 1;
        right[key] = { nested: true };

        expect(snapshotValuesEqual(left, right)).toBe(true);
        right.extra = 2;
        expect(snapshotValuesEqual(left, right)).toBe(false);
        expect(snapshotValuesEqual({}, Object.create(null))).toBe(false);

        const hiddenLeft = { value: 1 };
        const hiddenRight = { value: 1 };
        Object.defineProperty(hiddenLeft, 'hidden', { value: 'left' });
        Object.defineProperty(hiddenRight, 'hidden', { value: 'right' });
        expect(snapshotValuesEqual(hiddenLeft, hiddenRight)).toBe(true);
    });

    it('terminates on equivalent and different cyclic graphs', () => {
        const left: { value: number; self?: unknown } = { value: 1 };
        const same: { value: number; self?: unknown } = { value: 1 };
        const different: { value: number; self?: unknown } = { value: 2 };
        left.self = left;
        same.self = same;
        different.self = different;

        expect(snapshotValuesEqual(left, same)).toBe(true);
        expect(snapshotValuesEqual(left, different)).toBe(false);
    });

    it('is reflexive and symmetric for JSON-compatible values', () => {
        fc.assert(fc.property(fc.jsonValue(), fc.jsonValue(), (left, right) => {
            expect(snapshotValuesEqual(left, left)).toBe(true);
            expect(snapshotValuesEqual(left, right))
                .toBe(snapshotValuesEqual(right, left));
        }));
    });

    it('matches EntityKit clones of JSON-compatible values', () => {
        fc.assert(fc.property(fc.jsonValue(), value => {
            expect(snapshotValuesEqual(value, cloneSnapshotValue(value))).toBe(true);
        }));
    });
});
