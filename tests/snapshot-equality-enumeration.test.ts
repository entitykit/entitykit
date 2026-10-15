import { snapshotValuesEqual } from '../packages/core/src/tracking/snapshot-value-equality';

describe('snapshot equality enumeration boundaries', () => {
    it('captures both key lists before getters change either object', () => {
        const right: Record<string, unknown> = { first: 1, second: 9 };
        const left = {
            get first(): number {
                Reflect.deleteProperty(right, 'second');
                Object.setPrototypeOf(right, { second: 7 });
                Object.defineProperty(left, 'second', { enumerable: false });
                Object.defineProperty(right, 'hidden', { enumerable: true });
                right.added = 'late';
                return 1;
            },
            second: 7,
        };
        Object.defineProperty(right, 'hidden', { configurable: true, value: 'ignored' });

        expect(snapshotValuesEqual(left, right)).toBe(true);
        expect(Object.keys(left)).toEqual(['first']);
        expect(Object.keys(right)).toEqual(['first', 'hidden', 'added']);
    });

    it('finishes both proxy descriptor lists before comparing string and symbol values', () => {
        const visible = Symbol('visible'), hidden = Symbol('hidden');
        const events: string[] = [];
        const observe = (name: string): object => {
            const target = { first: 1, [visible]: 2 };
            Object.defineProperty(target, 'hidden', { value: 'omitted' });
            Object.defineProperty(target, hidden, { value: 'omitted' });
            return new Proxy(target, {
                ownKeys(object) {
                    events.push(name + ':keys');return Reflect.ownKeys(object);
                },
                getOwnPropertyDescriptor(object, key) {
                    events.push(name + ':descriptor:' + String(key));
                    return Reflect.getOwnPropertyDescriptor(object, key);
                },
                get(object, key, receiver): unknown {
                    events.push(name + ':get:' + String(key));
                    return Reflect.get(object, key, receiver) as unknown;
                },
            });
        };
        expect(snapshotValuesEqual(observe('left'), observe('right'))).toBe(true);
        expect(events).toEqual([
            'left:keys', 'left:descriptor:first', 'left:descriptor:hidden',
            'left:descriptor:Symbol(visible)', 'left:descriptor:Symbol(hidden)',
            'right:keys', 'right:descriptor:first', 'right:descriptor:hidden',
            'right:descriptor:Symbol(visible)', 'right:descriptor:Symbol(hidden)',
            'left:get:first', 'right:get:first', 'left:get:Symbol(visible)', 'right:get:Symbol(visible)',
        ]);
    });

    it('propagates a hidden descriptor failure before any value read and permits retry', () => {
        const hidden = Symbol('hidden'), failure = new Error('right descriptor failed');
        const events: string[] = [];
        let fail = true;
        const target = { first: 1 };
        Object.defineProperty(target, hidden, { value: 2 });
        const right = new Proxy(target, {
            ownKeys(object) {
                events.push('keys');return Reflect.ownKeys(object);
            },
            getOwnPropertyDescriptor(object, key) {
                events.push('descriptor:' + String(key));
                if (key === hidden && fail) throw failure;
                return Reflect.getOwnPropertyDescriptor(object, key);
            },
            get(object, key, receiver): unknown {
                events.push('get:' + String(key));return Reflect.get(object, key, receiver) as unknown;
            },
        });
        const left = { get first(): number {
            events.push('left:first');return 1;
        } };
        expect(() => snapshotValuesEqual(left, right)).toThrow(failure);
        expect(events).toEqual(['keys', 'descriptor:first', 'descriptor:Symbol(hidden)']);
        fail = false;events.length = 0;
        expect(snapshotValuesEqual(left, right)).toBe(true);
        expect(events).toEqual(['keys', 'descriptor:first', 'descriptor:Symbol(hidden)', 'left:first', 'get:first']);
    });

    it('keeps selected symbols after a string getter hides them', () => {
        const selected = Symbol('selected'), hidden = Symbol('hidden');
        const right = { first: 1, [selected]: 2 };
        const left = {
            get first(): number {
                Object.defineProperty(left, selected, { enumerable: false });
                Object.defineProperty(right, selected, { enumerable: false });
                Object.defineProperty(right, hidden, { enumerable: true });
                return 1;
            },
            [selected]: 3,
        };
        Object.defineProperty(right, hidden, { configurable: true, value: 'ignored' });
        expect(snapshotValuesEqual(left, right)).toBe(false);
    });
});
