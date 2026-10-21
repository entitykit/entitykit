import { snapshotValuesEqual } from '../packages/core/src/tracking/snapshot-value-equality';

describe('snapshot key membership and comparison order', () => {
    it.each([1, 4, 32, 256])('compares equal records independently of insertion order at width %s', width => {
        const entries = Array.from({ length: width }, (_, index) => [
            `field${String(index).padStart(4, '0')}`, { index, values: [index, null] },
        ] as const);
        const left = Object.fromEntries(entries);
        const same = Object.fromEntries(entries.map(([key, value]) => [key, { ...value, values: [...value.values] }]));
        const reverse = Object.fromEntries([...entries].reverse());
        const rotated = Object.fromEntries([...entries.slice(1), entries[0]]);
        for (const right of [same, reverse, rotated]) {
            expect(snapshotValuesEqual(left, right)).toBe(true);
            expect(snapshotValuesEqual(right, left)).toBe(true);
        }
        const changed: Record<string, unknown> = Object.fromEntries([...entries].reverse());
        changed[entries[width - 1][0]] = { index: -1, values: [] };
        expect(snapshotValuesEqual(left, changed)).toBe(false);
    });

    it('does not read values for a missing key or after the first unequal value', () => {
        const events: string[] = [];
        const left = {
            get first(): number {
                events.push('left:first'); return 1; 
            },
            get absent(): number {
                throw new Error('missing key must short-circuit'); 
            },
        };
        const right = {
            get first(): number {
                events.push('right:first'); return 1; 
            },
            get other(): number {
                throw new Error('unselected key must not be read'); 
            },
        };
        expect(snapshotValuesEqual(left, right)).toBe(false);
        expect(events).toEqual(['left:first', 'right:first']);
        Object.defineProperty(right, 'first', { get: () => 9 });
        expect(snapshotValuesEqual(left, right)).toBe(false);
    });

    it('distinguishes symbol identity and special string keys in reordered records', () => {
        const first = Symbol('same'), other = Symbol('same');
        const entries: Array<[PropertyKey, unknown]> = [
            ['__proto__', { safe: true }], ['constructor', 2], ['10', 10], ['2', 2], ['', null], [first, 7],
        ];
        const left: Record<PropertyKey, unknown> = Object.fromEntries(entries);
        const right: Record<PropertyKey, unknown> = Object.fromEntries([...entries].reverse());
        expect(snapshotValuesEqual(left, right)).toBe(true);
        Reflect.deleteProperty(right, first);right[other] = 7;
        expect(snapshotValuesEqual(left, right)).toBe(false);
        expect(Object.getPrototypeOf(left)).toBe(Object.prototype);
    });

    it.each(['proxy', 'symbol'])('preserves species-exposed fallback key reads: %s', mode => {
        const captured: PropertyKey[][] = [];
        const events: string[] = [];
        const symbol = Symbol('visible');
        const rightTarget: Record<PropertyKey, unknown> = { first: 1, second: 2 };
        const leftTarget: Record<PropertyKey, unknown> = {
            get first(): number {
                events.push('left:first');
                const keys = captured.at(1);
                if (!keys) throw new Error('both key lists must already exist');
                Object.defineProperty(keys, '0', { get: () => {
                    events.push('key:first');rightTarget.second = 9;return 'first';
                } });
                return 1;
            },
            second: 2,
        };
        if (mode === 'symbol') {
            leftTarget[symbol] = 3;rightTarget[symbol] = 3; 
        }
        const left = mode === 'proxy' ? new Proxy(leftTarget, {}) : leftTarget;
        const right = mode === 'proxy' ? new Proxy(rightTarget, {}) : rightTarget;
        class CapturedKeys extends Array<PropertyKey> {
            constructor(length: number) {
                super(length);captured.push(this); 
            }
        }
        const descriptor = Object.getOwnPropertyDescriptor(Array, Symbol.species);
        let equal: boolean;
        try {
            Object.defineProperty(Array, Symbol.species, { configurable: true, get: () => CapturedKeys });
            equal = snapshotValuesEqual(left, right);
        } finally {
            if (descriptor) Object.defineProperty(Array, Symbol.species, descriptor);
            else Reflect.deleteProperty(Array, Symbol.species);
        }
        expect(equal).toBe(false);
        expect(captured).toHaveLength(2);
        expect(events).toEqual(['left:first', 'key:first']);
        expect(rightTarget.second).toBe(9);
    });
});
