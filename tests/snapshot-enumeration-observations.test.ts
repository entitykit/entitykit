import { cloneSnapshotValue } from '../packages/core/src/tracking/snapshot-value-clone';

describe('snapshot enumeration observations', () => {
    it.each([null, Object.prototype as object])('captures keys and prototype before getters change the source: %p', prototype => {
        const source = Object.create(prototype) as Record<string, unknown>;
        const shared = { value: 1 };
        Object.defineProperty(source, 'first', {
            enumerable: true,
            get: () => {
                Reflect.deleteProperty(source, 'second');
                Object.setPrototypeOf(source, { second: { inherited: true } });
                Object.defineProperty(source, 'third', { enumerable: false });
                Object.defineProperty(source, 'hidden', { enumerable: true });
                source.added = 'late';
                return shared;
            },
        });
        Object.defineProperty(source, 'second', { configurable: true, enumerable: true, value: 'removed' });
        Object.defineProperty(source, 'third', { configurable: true, enumerable: true, value: shared });
        Object.defineProperty(source, 'hidden', { configurable: true, value: 'not originally enumerable' });

        const copy = cloneSnapshotValue(source) as typeof source;

        expect(Object.getPrototypeOf(copy)).toBe(prototype);
        expect(Reflect.ownKeys(copy)).toEqual(['first', 'second', 'third']);
        expect(copy.first).toEqual({ value: 1 });
        expect(copy.first).toBe(copy.third);
        expect(copy.first).not.toBe(shared);
        expect(copy.second).toEqual({ inherited: true });
        expect(copy.second).not.toBe(source.second);
        expect(Object.getOwnPropertyDescriptor(copy, 'third')?.enumerable).toBe(true);
        shared.value = 2;
        expect(copy.third).toEqual({ value: 1 });
    });

    it('inspects all proxy string and symbol descriptors once before reading enumerable values', () => {
        const visible = Symbol('visible'), hidden = Symbol('hidden');
        const events: string[] = [];
        const target = { first: 'one', [visible]: { owned: true } };
        Object.defineProperty(target, 'hidden', { value: 'not copied' });
        Object.defineProperty(target, hidden, { value: 'not copied' });
        const source = new Proxy(target, {
            ownKeys(object) {
                events.push('keys');return Reflect.ownKeys(object);
            },
            getOwnPropertyDescriptor(object, key) {
                events.push(`descriptor:${String(key)}`);return Reflect.getOwnPropertyDescriptor(object, key);
            },
            get(object, key, receiver): unknown {
                events.push(`get:${String(key)}`);
                expect(receiver).toBe(source);
                return Reflect.get(object, key, receiver) as unknown;
            },
        });

        const copy = cloneSnapshotValue(source) as typeof target;

        expect(events).toEqual(['keys', 'descriptor:first', 'descriptor:hidden',
            'descriptor:Symbol(visible)', 'descriptor:Symbol(hidden)', 'get:first', 'get:Symbol(visible)']);
        expect(Reflect.ownKeys(copy)).toEqual(['first', visible]);
        expect(copy[visible]).toEqual({ owned: true });
        expect(copy[visible]).not.toBe(target[visible]);
    });

    it('fails on a hidden symbol descriptor before reading values and permits a fresh retry', () => {
        const hidden = Symbol('hidden'), failure = new Error('hidden descriptor failed');
        const events: string[] = [];
        let fail = true;
        const target = { first: { value: 1 } };
        Object.defineProperty(target, hidden, { configurable: true, value: 'hidden' });
        const source = new Proxy(target, {
            ownKeys(object) {
                events.push('keys');return Reflect.ownKeys(object);
            },
            getOwnPropertyDescriptor(object, key) {
                events.push(`descriptor:${String(key)}`);
                if (key === hidden && fail) throw failure;
                return Reflect.getOwnPropertyDescriptor(object, key);
            },
            get(object, key, receiver): unknown {
                events.push(`get:${String(key)}`);return Reflect.get(object, key, receiver) as unknown;
            },
        });

        expect(() => cloneSnapshotValue(source)).toThrow(failure);
        expect(events).toEqual(['keys', 'descriptor:first', 'descriptor:Symbol(hidden)']);
        fail = false;events.length = 0;
        const copy = cloneSnapshotValue(source) as typeof target;
        expect(events).toEqual(['keys', 'descriptor:first', 'descriptor:Symbol(hidden)', 'get:first']);
        expect(copy).toEqual(target);
        expect(copy.first).not.toBe(target.first);
    });

    it('retains the captured symbol selection when a string getter changes enumerability', () => {
        const selected = Symbol('selected'), hidden = Symbol('hidden');
        const source: Record<PropertyKey, unknown> = {};
        const shared = { value: 1 };
        Object.defineProperty(source, 'first', { enumerable: true, get: () => {
            Object.defineProperty(source, selected, { enumerable: false });
            Object.defineProperty(source, hidden, { enumerable: true });
            return shared;
        } });
        Object.defineProperty(source, selected, { configurable: true, enumerable: true, value: shared });
        Object.defineProperty(source, hidden, { configurable: true, value: 'omitted' });

        const copy = cloneSnapshotValue(source) as typeof source;

        expect(Reflect.ownKeys(copy)).toEqual(['first', selected]);
        expect(copy.first).toBe(copy[selected]);
        expect(copy.first).not.toBe(shared);
        expect(Object.getOwnPropertyDescriptor(copy, selected)).toEqual({
            configurable: true, enumerable: true, writable: true, value: copy.first,
        });
    });
});
