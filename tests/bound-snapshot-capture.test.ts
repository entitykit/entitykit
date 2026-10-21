import { cloneBoundValues } from '../packages/core/src/tracking/bound-value-snapshot';

describe('bound snapshot property capture', () => {
    it('ignores symbol accessors without reading them', () => {
        const symbol = Symbol('ignored');
        const getter = jest.fn(() => {
            throw new Error('Symbol must not be read.'); 
        });
        const values = { nested: { label: 'original' } };
        Object.defineProperty(values, symbol, { enumerable: true, get: getter });
        const copy = cloneBoundValues(values);
        expect(Reflect.ownKeys(copy)).toEqual(['nested']);
        expect(copy.nested).toEqual(values.nested);
        expect(copy.nested).not.toBe(values.nested);
        expect(getter).not.toHaveBeenCalled();
    });

    it('preserves proxy enumeration and getter order', () => {
        const events: string[] = [];
        const nested = { get value(): number {
            events.push('nested'); return 7; 
        } };
        const values = new Proxy({ first: nested, second: 'later' }, {
            ownKeys(target) {
                events.push('keys'); return Reflect.ownKeys(target); 
            },
            getOwnPropertyDescriptor(target, key) {
                events.push('descriptor:' + String(key));
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
            get(target, key, receiver) {
                events.push('get:' + String(key));
                return Reflect.get(target, key, receiver) as unknown;
            },
        });
        expect(cloneBoundValues(values)).toEqual({ first: { value: 7 }, second: 'later' });
        expect(events).toEqual([
            'keys', 'descriptor:first', 'get:first', 'descriptor:second', 'get:second', 'nested',
        ]);
    });

    it('captures only the original keys that remain enumerable when read', () => {
        const symbol = Symbol('added later');
        const values: Record<PropertyKey, unknown> = {};
        Object.defineProperty(values, 'first', {
            enumerable: true,
            get() {
                delete values.removed;
                Object.defineProperty(values, 'hiddenLater', { enumerable: false });
                values.added = true;
                Object.defineProperty(values, symbol, {
                    enumerable: true,
                    get() {
                        throw new Error('New symbol must not be read.'); 
                    },
                });
                return { value: 7 };
            },
        });
        values.removed = true;
        values.hiddenLater = true;
        expect(cloneBoundValues(values)).toEqual({ first: { value: 7 } });
    });

    it('owns special string keys without invoking inherited setters', () => {
        const values = Object.create(null) as Record<string, unknown>;
        Object.defineProperty(values, '__proto__', { enumerable: true, value: { own: true } });
        Object.defineProperty(values, 'constructor', { enumerable: true, value: { own: true } });
        const copy = cloneBoundValues(values);
        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect(Object.keys(copy)).toEqual(['__proto__', 'constructor']);
        for (const key of Object.keys(values)) {
            expect(Object.getOwnPropertyDescriptor(copy, key)).toEqual({
                enumerable: true, configurable: true, writable: true, value: { own: true },
            });
            expect(copy[key]).not.toBe(values[key]);
        }
    });

    it('keeps primitive and function values unchanged', () => {
        const callback = (): number => 1;
        const values = { nil: null, missing: undefined, nan: NaN, zero: -0, bool: true, bigint: 1n, callback };
        const copy = cloneBoundValues(values);
        expect(copy).not.toBe(values);
        for (const key of Object.keys(values) as Array<keyof typeof values>) {
            expect(Object.is(copy[key], values[key])).toBe(true);
        }
    });
});
