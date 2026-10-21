import { runInNewContext } from 'node:vm';
import { cloneSnapshotValue } from '../packages/core/src/tracking/snapshot-value-clone';

function record(prototype: object | null): Record<PropertyKey, unknown> {
    return Object.create(prototype) as Record<PropertyKey, unknown>;
}

function defineValue(target: object, key: PropertyKey, value: unknown): void {
    Object.defineProperty(target, key, { enumerable: true, value });
}

function expectOwnedValue(target: object, key: PropertyKey, value: unknown): void {
    expect(Object.getOwnPropertyDescriptor(target, key)).toEqual({
        configurable: true, enumerable: true, writable: true, value,
    });
}

describe('snapshot object property writes', () => {
    it.each([null, Object.prototype as object])('copies own keys and data descriptors with prototype %p', prototype => {
        const symbol = Symbol('snapshot');
        const source = record(prototype);
        const nested = { value: 7 };
        defineValue(source, '12', 'numeric');
        defineValue(source, 'name', 'before');
        defineValue(source, '__proto__', nested);
        defineValue(source, 'constructor', nested);
        defineValue(source, symbol, nested);
        Object.defineProperty(source, 'hidden', { value: 'omitted' });
        Object.freeze(source);

        const copy = cloneSnapshotValue(source) as typeof source;

        expect(Object.getPrototypeOf(copy)).toBe(prototype);
        expect(Reflect.ownKeys(copy)).toEqual(['12', 'name', '__proto__', 'constructor', symbol]);
        expect(copy.__proto__).toEqual(nested);
        expect(copy.__proto__).not.toBe(nested);
        expect(copy.constructor).toBe(copy.__proto__);
        expect(copy[symbol]).toBe(copy.__proto__);
        for (const key of Reflect.ownKeys(copy)) expectOwnedValue(copy, key, copy[key]);
        copy.name = 'after';
        nested.value = 9;
        expect(source.name).toBe('before');
        expect(copy.__proto__).toEqual({ value: 7 });
    });

    it('defines own fields over inherited setters and non-writable custom fields', () => {
        const writes: unknown[] = [];
        const prototype = {
            set guarded(value: unknown) {
                writes.push(value);
            },
        };
        Object.defineProperty(prototype, 'locked', { value: 'inherited' });
        const source = record(prototype);
        defineValue(source, 'guarded', { value: 1 });
        defineValue(source, 'locked', 'owned');

        const copy = cloneSnapshotValue(source) as typeof source;

        expect(writes).toEqual([]);
        expect(Object.getPrototypeOf(copy)).toBe(prototype);
        expectOwnedValue(copy, 'guarded', { value: 1 });
        expectOwnedValue(copy, 'locked', 'owned');
        expect(copy.guarded).not.toBe(source.guarded);
    });

    it('retains a foreign realm prototype and owns the copied properties', () => {
        const source = runInNewContext('({ text: "value", nested: { id: 3 } })') as Record<string, unknown>;
        const prototype: unknown = Object.getPrototypeOf(source);
        expect(prototype).not.toBe(Object.prototype);

        const copy = cloneSnapshotValue(source) as typeof source;

        expect(Object.getPrototypeOf(copy)).toBe(prototype);
        expectOwnedValue(copy, 'text', 'value');
        expect(copy.nested).toEqual({ id: 3 });
        expect(copy.nested).not.toBe(source.nested);
        expect(Object.getPrototypeOf(copy.nested)).toBe(Object.getPrototypeOf(source.nested));
    });

    it('does not inspect custom prototype properties through proxy traps', () => {
        const key = Symbol('custom prototype');
        let inspections = 0;
        const prototype = new Proxy({}, {
            getOwnPropertyDescriptor(): never {
                inspections++;
                throw new Error('Unexpected prototype descriptor lookup');
            },
        });
        const source = record(prototype);
        defineValue(source, key, { value: 'owned' });

        const copy = cloneSnapshotValue(source) as typeof source;

        expect(inspections).toBe(0);
        expect(Object.getPrototypeOf(copy)).toBe(prototype);
        expectOwnedValue(copy, key, { value: 'owned' });
    });

    it.each([
        [false, false, 'setter'], [false, true, 'setter'],
        [false, false, 'readonly'], [false, true, 'readonly'],
        [true, false, 'setter'], [true, true, 'readonly'],
    ] as const)('handles prototype changes during capture: null=%p nested=%p kind=%s', (nullPrototype, nested, kind) => {
        const key = Symbol('installed during snapshot capture');
        const source = record(nullPrototype ? null : Object.prototype);
        let writes = 0;
        const events: string[] = [];
        function install(): void {
            events.push('install');
            Object.defineProperty(Object.prototype, key, kind === 'setter'
                ? { configurable: true, set: (): void => {
                    writes++;
                } }
                : { configurable: true, writable: false, value: 'inherited' });
        }
        const value = nested ? {
            get inner(): string {
                install();
                return 'captured';
            },
        } : 'captured';
        Object.defineProperty(source, key, {
            enumerable: true,
            get(): unknown {
                expect(this).toBe(source);
                events.push('read');
                if (!nested) install();
                return value;
            },
        });
        try {
            const copy = cloneSnapshotValue(source) as typeof source;

            expect(writes).toBe(0);
            expect(events).toEqual(['read', 'install']);
            expect(Object.getPrototypeOf(copy)).toBe(Object.getPrototypeOf(source));
            expectOwnedValue(copy, key, nested ? { inner: 'captured' } : 'captured');
        } finally {
            Reflect.deleteProperty(Object.prototype, key);
        }
    });

    it('finishes enumeration before reading values and keeps proxy getter receivers', () => {
        const events: string[] = [];
        const target = { first: { value: 1 }, second: 'two' };
        const source = new Proxy(target, {
            ownKeys(object): Array<string | symbol> {
                events.push('keys');
                return Reflect.ownKeys(object);
            },
            getOwnPropertyDescriptor(object, key): PropertyDescriptor | undefined {
                events.push(`descriptor:${String(key)}`);
                return Reflect.getOwnPropertyDescriptor(object, key);
            },
            get(object, key, receiver): unknown {
                events.push(`get:${String(key)}`);
                expect(receiver).toBe(source);
                return Reflect.get(object, key, receiver) as unknown;
            },
        });

        const copy = cloneSnapshotValue(source) as typeof target;

        expect(events).toEqual(['keys', 'descriptor:first', 'descriptor:second', 'get:first', 'get:second']);
        expect(copy).toEqual(target);
        expect(copy.first).not.toBe(target.first);
        expectOwnedValue(copy, 'second', 'two');
    });

    it('preserves the first getter error without reading later values', () => {
        const failure = new Error('snapshot getter failed');
        const events: string[] = [];
        const source = {
            get first(): object {
                events.push('first');
                return { copied: true };
            },
            get second(): never {
                events.push('second');
                throw failure;
            },
            get third(): number {
                events.push('third');
                return 3;
            },
        };

        expect(() => cloneSnapshotValue(source)).toThrow(failure);
        expect(events).toEqual(['first', 'second']);
    });

    it.each([null, Object.prototype as object])('preserves shared cycles and independent mutable data with %p', prototype => {
        const shared = { value: 'before' };
        const source = record(prototype);
        source.first = shared;
        source.second = shared;
        source.self = source;
        source.list = [shared, source];

        const copy = cloneSnapshotValue(source) as typeof source;

        expect(copy.first).not.toBe(shared);
        expect(copy.first).toBe(copy.second);
        expect(copy.self).toBe(copy);
        expect(copy.list).toEqual([copy.first, copy]);
        shared.value = 'after';
        expect(copy.first).toEqual({ value: 'before' });
    });
});
