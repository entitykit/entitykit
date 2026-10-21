import { cloneUnconvertedEntityValues } from '../packages/core/src/materialization/compiled-entity-values';

describe('compiled model root capture', () => {
    it('captures live enumerable keys and every root getter before nested copies', () => {
        const events: string[] = [];
        const source: Record<string, unknown> = {};
        Object.defineProperties(source, {
            first: {
                enumerable: true, get: () => {
                    events.push('first');
                    Reflect.deleteProperty(source, 'removed');
                    source.added = 4;
                    Object.defineProperty(source, 'hidden', { enumerable: true });
                    return { get nested() {
                        events.push('nested');return 1;
                    } };
                },
            },
            removed: { configurable: true, enumerable: true, value: 2 },
            tail: { enumerable: true, get: () => {
                events.push('tail');return { value: 3 };
            } },
            hidden: { configurable: true, enumerable: false, get: () => {
                events.push('hidden');return 5;
            } },
        });
        const copy = cloneUnconvertedEntityValues(source);
        expect(events).toEqual(['first', 'tail', 'hidden', 'nested']);
        expect(Object.keys(copy)).toEqual(['first', 'tail', 'hidden']);
        expect(copy).toEqual({ first: { nested: 1 }, tail: { value: 3 }, hidden: 5 });
        expect(Object.hasOwn(source, 'added')).toBe(true);
    });

    it('ignores a symbol added after root enumeration begins', () => {
        const symbol = Symbol('late root field');
        const source: Record<string, unknown> = {};
        Object.defineProperties(source, {
            first: { enumerable: true, get: () => {
                Object.defineProperty(source, symbol, {
                    configurable: true, enumerable: true,
                    get: () => {
                        throw new Error('symbol getter must not run'); 
                    },
                });
                return 1;
            } },
            tail: { enumerable: true, value: 2 },
        });
        expect(cloneUnconvertedEntityValues(source)).toEqual({ first: 1, tail: 2 });
        expect(cloneUnconvertedEntityValues(source)).toEqual({ first: 1, tail: 2 });
    });

    it.each([false, true])('does not read existing symbol getters, proxy %s', proxy => {
        const source = Object.defineProperty({ value: { nested: 1 } }, Symbol('ignored'), {
            enumerable: true, get: () => {
                throw new Error('symbol getter must not run'); 
            },
        });
        const input = proxy ? new Proxy(source, {}) : source;
        const copy = cloneUnconvertedEntityValues(input);
        expect(Reflect.ownKeys(copy)).toEqual(['value']);
        expect(copy).toEqual({ value: { nested: 1 } });
        expect(copy.value).not.toBe(source.value);
    });

    it('preserves proxy key, descriptor and value observations without a second enumeration', () => {
        const events: string[] = [], symbol = Symbol('ignored');
        const source = { first: { get nested() {
            events.push('nested');return 1;
        } }, tail: 2, [symbol]: 3 };
        const proxy = new Proxy(source, {
            ownKeys: () => {
                events.push('keys');return ['tail', 'first', symbol];
            },
            getOwnPropertyDescriptor: (target, key) => {
                events.push(`descriptor:${String(key)}`);
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
            get: (target, key, receiver) => {
                events.push(`get:${String(key)}`);
                return Reflect.get(target, key, receiver) as unknown;
            },
        });
        const copy = cloneUnconvertedEntityValues(proxy);
        expect(events).toEqual(['keys', 'descriptor:tail', 'get:tail', 'descriptor:first', 'get:first', 'nested']);
        expect(Object.keys(copy)).toEqual(['tail', 'first']);
        expect(copy).toEqual({ tail: 2, first: { nested: 1 } });
    });

    it('preserves numeric and special own keys from a null-prototype root', () => {
        const source = Object.create(null) as Record<string, unknown>;
        for (const key of ['__proto__', 'constructor', 'toString', '10', '2']) {
            Object.defineProperty(source, key, {
                configurable: true, enumerable: true, writable: true, value: { key },
            });
        }
        const copy = cloneUnconvertedEntityValues(source);
        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect(Object.keys(copy)).toEqual(['2', '10', '__proto__', 'constructor', 'toString']);
        for (const key of Object.keys(source)) {
            expect(Object.hasOwn(copy, key)).toBe(true);
            expect(copy[key]).toEqual({ key });
            expect(copy[key]).not.toBe(source[key]);
        }
    });

    it('does not begin nested copying when a later root getter fails', () => {
        const events: string[] = [], failure = new Error('later root failed');
        const source = {
            first: { get nested() {
                events.push('nested');return 1;
            } },
            get later() {
                events.push('later');throw failure;
            },
        };
        expect(() => cloneUnconvertedEntityValues(source)).toThrow(failure);
        expect(events).toEqual(['later']);
        const next = { first: { nested: 2 } }, copy = cloneUnconvertedEntityValues(next);
        expect(copy).toEqual(next);
        expect(copy.first).not.toBe(next.first);
    });

    it('exposes only the result root to an inherited setter installed by a root getter', () => {
        const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'captureTail');
        const receivers: object[] = [], keys: string[][] = [], values: unknown[] = [];
        const source = {
            get first() {
                Object.defineProperty(Object.prototype, 'captureTail', {
                    configurable: true,
                    set(this: object, value: unknown) {
                        receivers.push(this);keys.push(Object.keys(this));values.push(value);
                    },
                });
                return 1;
            },
            captureTail: 2,
        };
        let copy: Record<string, unknown>;
        try {
            copy = cloneUnconvertedEntityValues(source);
        } finally {
            if (previous) Object.defineProperty(Object.prototype, 'captureTail', previous);
            else Reflect.deleteProperty(Object.prototype, 'captureTail');
        }
        expect(receivers).toEqual([copy]);
        expect(keys).toEqual([['first']]);
        expect(values).toEqual([2]);
        expect(copy).toEqual({ first: 1 });
        expect(Object.hasOwn(copy, 'captureTail')).toBe(false);
    });
});
