import { snapshotValuesEqual } from '../packages/core/src/tracking/snapshot-value-equality';

function cyclic(value: number): { value: number; self?: unknown } {
    const result: { value: number; self?: unknown } = { value };
    result.self = result;
    return result;
}

describe('snapshot comparison pair boundaries', () => {
    it.each([false, true])('compares every counterpart of a shared object, reversed=%s', reversed => {
        const shared = cyclic(1);
        const left = [shared, shared, shared, shared];
        const right = [cyclic(1), cyclic(1), cyclic(1), cyclic(1)];
        expect(snapshotValuesEqual(left, right)).toBe(true);
        expect(snapshotValuesEqual(right, left)).toBe(true);
        for (const counterpart of right) {
            counterpart.value = 2;
            expect(snapshotValuesEqual(reversed ? right : left, reversed ? left : right)).toBe(false);
            counterpart.value = 1;
        }
    });

    it.each(['array', 'map', 'set'] as const)('keeps multiple cyclic counterparts through %s', kind => {
        const left = cyclic(1);
        const first = cyclic(1);
        const second = cyclic(1);
        const values = (a: object, b: object): unknown => {
            if (kind === 'map') return new Map([[a, a], [b, b]]);
            if (kind === 'set') return new Set([{ value: a }, { value: b }]);
            return [a, b, a, b];
        };
        const a = kind === 'map' ? new Map([[{}, left], [{}, left]]) : values(left, left);
        const b = kind === 'map' ? new Map([[{}, first], [{}, second]]) : values(first, second);
        expect(snapshotValuesEqual(a, b)).toBe(true);
        second.value = 2;
        expect(snapshotValuesEqual(a, b)).toBe(false);
    });

    it('remembers both first and later pairs without reobserving their properties', () => {
        const reads: string[] = [];
        const value = (name: string): object => Object.defineProperty({}, 'value', {
            enumerable: true,
            get: () => {
                reads.push(name); return 1;
            },
        });
        const left = value('left');
        const first = value('first');
        const second = value('second');
        const third = value('third');
        expect(snapshotValuesEqual(
            [left, left, left, left, left, left],
            [first, second, first, third, second, third],
        )).toBe(true);
        expect(reads).toEqual(['left', 'first', 'left', 'second', 'left', 'third']);
    });

    it('keeps comparison state private to each call after a getter failure', () => {
        let fail = true;
        const left = Object.defineProperty({}, 'value', {
            enumerable: true,
            get: () => {
                if (fail) throw new Error('comparison failed'); return 1;
            },
        });
        const right = { value: 2 };
        expect(() => snapshotValuesEqual([left, left], [right, right])).toThrow('comparison failed');
        fail = false;
        expect(snapshotValuesEqual([left, left], [right, right])).toBe(false);
    });

    it('isolates a reentrant comparison triggered while reading a value', () => {
        const shared = cyclic(1);
        const left = Object.defineProperty({}, 'value', {
            enumerable: true,
            get: () => {
                expect(snapshotValuesEqual([shared, shared], [cyclic(1), cyclic(2)])).toBe(false);
                return 1;
            },
        });
        expect(snapshotValuesEqual([left, left], [{ value: 1 }, { value: 1 }])).toBe(true);
    });

    it('preserves supplied pair sets and their accumulated counterpart membership', () => {
        const left = cyclic(1);
        const first = cyclic(1);
        const second = cyclic(2);
        const pairs: WeakSet<object> = new WeakSet([first]);
        const seen: WeakMap<object, WeakSet<object>> = new WeakMap([[left, pairs]]);
        expect(snapshotValuesEqual(left, first, seen)).toBe(true);
        expect(snapshotValuesEqual(left, second, seen)).toBe(false);
        expect(seen.get(left)).toBe(pairs);
        expect(pairs.has(first)).toBe(true);
        expect(pairs.has(second)).toBe(true);
        expect(snapshotValuesEqual(left, second, seen)).toBe(true);
        expect(snapshotValuesEqual(left, second)).toBe(false);
    });

    it('shares supplied cache state with nested comparisons before reading getters', () => {
        const leftChild = { value: 1 };
        const rightChild = { value: 2 };
        const seen: WeakMap<object, WeakSet<object>> = new WeakMap();
        const left = Object.defineProperty({}, 'child', {
            enumerable: true,
            get: () => {
                seen.set(leftChild, new WeakSet([rightChild])); return leftChild;
            },
        });
        const right = { child: rightChild };
        expect(snapshotValuesEqual(left, right, seen)).toBe(true);
        expect(seen.get(left)?.has(right)).toBe(true);
        expect(snapshotValuesEqual(leftChild, rightChild)).toBe(false);
    });

    it('preserves supplied map get and set order and receivers', () => {
        const seen: WeakMap<object, WeakSet<object>> = new WeakMap();
        const left = { value: 1 };
        const first = { value: 1 };
        const second = { value: 1 };
        const events: string[] = [];
        seen.get = function(key) {
            expect(this).toBe(seen);
            events.push('get');
            return WeakMap.prototype.get.call(this, key) as WeakSet<object> | undefined;
        };
        seen.set = function(key, value) {
            expect(this).toBe(seen);
            events.push('set');
            WeakMap.prototype.set.call(this, key, value);
            return this;
        };
        expect(snapshotValuesEqual(left, first, seen)).toBe(true);
        expect(snapshotValuesEqual(left, first, seen)).toBe(true);
        expect(snapshotValuesEqual(left, second, seen)).toBe(true);
        expect(events).toEqual(['get', 'set', 'get', 'get', 'set']);
    });

    it('does not inspect the prototype of a supplied cache proxy', () => {
        const cache: WeakMap<object, WeakSet<object>> = new WeakMap();
        const seen = new Proxy(cache, {
            get(target, key): unknown {
                if (key === 'get') return target.get.bind(target);
                if (key === 'set') return target.set.bind(target);
                throw new Error('unexpected cache property');
            },
            getPrototypeOf: () => {
                throw new Error('cache prototype observed');
            },
        });
        const left = cyclic(1);
        const right = cyclic(1);
        expect(snapshotValuesEqual(left, right, seen)).toBe(true);
        expect(cache.get(left)?.has(right)).toBe(true);
    });

    it('keeps native leaf comparisons ahead of supplied pair-cache lookup', () => {
        const seen: WeakMap<object, WeakSet<object>> = new WeakMap();
        seen.get = () => {
            throw new Error('unexpected cache lookup');
        };
        expect(snapshotValuesEqual(1, 1, seen)).toBe(true);
        expect(snapshotValuesEqual(1, 2, seen)).toBe(false);
        expect(snapshotValuesEqual(new Date(1), new Date(1), seen)).toBe(true);
        expect(snapshotValuesEqual(/a/g, /b/g, seen)).toBe(false);
        expect(snapshotValuesEqual(new Uint8Array([1]), new Uint8Array([2]), seen)).toBe(false);
        expect(snapshotValuesEqual(Object.create(null), {}, seen)).toBe(false);
    });
});
