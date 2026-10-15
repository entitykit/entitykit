import { normalizeJsonValue, serializeJsonValue } from '../packages/core/src/json-value';
import { observedJsonRejection } from './support/observed-json-rejection';

const guardedKey = '__entitykit_json_normalization_guard__';

function expectOwned(target: object, key: string, value: unknown): void {
    expect(Object.getOwnPropertyDescriptor(target, key)).toEqual({
        configurable: true, enumerable: true, writable: true, value,
    });
}

describe('JSON normalization property writes', () => {
    it('avoids definitions for owned ordinary keys while retaining independent nested values', () => {
        const source = Array.from({ length: 100 }, (_, id) => ({
            id, nested: { value: id }, list: [{ label: 'row' }],
        }));
        const define = jest.spyOn(Object, 'defineProperty');
        let copy: typeof source;
        let definitions: number;
        try {
            copy = normalizeJsonValue(source) as typeof source;
            definitions = define.mock.calls.length;
        } finally {
            define.mockRestore();
        }
        expect(definitions).toBe(0);
        expect(copy).toEqual(source);
        for (let index = 0; index < source.length; index++) {
            expect(copy[index]).not.toBe(source[index]);
            expect(copy[index].nested).not.toBe(source[index].nested);
            expect(copy[index].list).not.toBe(source[index].list);
            expect(copy[index].list[0]).not.toBe(source[index].list[0]);
        }
    });

    it('keeps definitions for prototype-sensitive keys', () => {
        const source: unknown = JSON.parse('{"__proto__":{"value":1},"constructor":2,"toString":3}');
        const define = jest.spyOn(Object, 'defineProperty');
        let copy: unknown;
        let definitions: number;
        try {
            copy = normalizeJsonValue(source);
            definitions = define.mock.calls.length;
        } finally {
            define.mockRestore();
        }
        expect(definitions).toBe(3);
        expect(copy).toEqual(source);
        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    });

    it.each([null, Object.prototype as object])('owns sorted writable values from prototype %p', prototype => {
        const source = Object.create(prototype) as Record<string, unknown>;
        const shared = { value: 'before' };
        for (const key of ['z', '12', '2', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
            Object.defineProperty(source, key, { enumerable: true, value: shared });
        }
        Object.defineProperty(source, 'hidden', { value: 'omitted' });
        Object.freeze(source);

        const copy = normalizeJsonValue(source) as Record<string, unknown>;

        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect(Reflect.ownKeys(copy)).toEqual(['2', '12', '', '__proto__', 'constructor', 'hasOwnProperty', 'toString', 'z']);
        for (const key of Object.keys(copy)) {
            expectOwned(copy, key, { value: 'before' });
            expect(copy[key]).toBe(copy.z);
            expect(copy[key]).not.toBe(shared);
        }
        expect(serializeJsonValue({ '2': 2, '12': 12, '': 0 })).toBe('{"":0,"12":12,"2":2}');
        shared.value = 'after';
        expect(copy.z).toEqual({ value: 'before' });
        copy.z = 'replaced';
        expect(source.z).toBe(shared);
        expect(Reflect.deleteProperty(copy, 'constructor')).toBe(true);
        expect(Object.hasOwn(copy, 'constructor')).toBe(false);
    });

    it.each(['setter', 'readonly'] as const)('defines an own property over an inherited %s', kind => {
        let observations = 0;
        const source = { [guardedKey]: { value: 'owned' } };
        Object.defineProperty(Object.prototype, guardedKey, kind === 'setter'
            ? { configurable: true, get: (): never => {
                observations++;
                throw new Error('inherited getter invoked');
            }, set: (): void => {
                observations++;
            } }
            : { configurable: true, value: 'inherited', writable: false });
        try {
            const copy = normalizeJsonValue(source) as Record<string, unknown>;
            expect(observations).toBe(0);
            expectOwned(copy, guardedKey, { value: 'owned' });
            expect(copy[guardedKey]).not.toBe(source[guardedKey]);
        } finally {
            Reflect.deleteProperty(Object.prototype, guardedKey);
        }
    });

    it.each([
        ['getPrototypeOf', 'setter'], ['ownKeys', 'setter'], ['getOwnPropertyDescriptor', 'setter'],
        ['getPrototypeOf', 'readonly'], ['ownKeys', 'readonly'], ['getOwnPropertyDescriptor', 'readonly'],
    ] as const)('checks inherited %s effects after nested inspection installs a %s', (trigger, kind) => {
        let observations = 0;
        const events: string[] = [];
        function inspect(event: string): void {
            events.push(event);
            if (event !== trigger) return;
            Object.defineProperty(Object.prototype, guardedKey, kind === 'setter'
                ? { configurable: true, set: (): void => {
                    observations++;
                } }
                : { configurable: true, value: 'inherited', writable: false });
        }
        const child = new Proxy({ value: 'owned' }, {
            getPrototypeOf(target): object | null {
                inspect('getPrototypeOf');
                return Reflect.getPrototypeOf(target);
            },
            ownKeys(target): Array<string | symbol> {
                inspect('ownKeys');
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
                inspect('getOwnPropertyDescriptor');
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
            get(): never {
                throw new Error('source value read through proxy');
            },
        });
        try {
            const copy = normalizeJsonValue({ [guardedKey]: child });
            expect(observations).toBe(0);
            expect(events).toEqual(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']);
            expectOwned(copy as object, guardedKey, { value: 'owned' });
        } finally {
            Reflect.deleteProperty(Object.prototype, guardedKey);
        }
    });

    it('retains first-error ordering and drains later rejections after a thenable changes the prototype', () => {
        let observations = 0;
        const rejected = observedJsonRejection(new Error('later rejection'));
        const then = jest.fn((): void => {
            Object.defineProperty(Object.prototype, guardedKey, {
                configurable: true,
                set: (): void => {
                    observations++;
                },
            });
        });
        try {
            expect(() => normalizeJsonValue({ z: rejected.promise, [guardedKey]: { then } }, 'Document.data'))
                .toThrow(`Unsupported JSON value at 'Document.data.${guardedKey}' (Promise or thenable)`);
            expect(then).toHaveBeenCalledTimes(1);
            expect(rejected.observed()).toBe(true);
            expect(observations).toBe(0);
        } finally {
            Reflect.deleteProperty(Object.prototype, guardedKey);
        }
        expect(normalizeJsonValue({ [guardedKey]: 'next call' })).toEqual({ [guardedKey]: 'next call' });
    });

    it('retains symbol rejection precedence while finishing later string normalization', () => {
        const events: string[] = [];
        const then = (): void => {
            events.push('symbol rejection drained');
        };
        const child = new Proxy({ value: 1 }, {
            ownKeys(target): Array<string | symbol> {
                events.push('string child inspected');
                return Reflect.ownKeys(target);
            },
        });
        expect(() => normalizeJsonValue({ [Symbol('hidden')]: { then }, ordinary: child }, 'Document.data'))
            .toThrow('Unsupported JSON value at \'Document.data\' (symbol-keyed property)');
        expect(events).toEqual(['symbol rejection drained', 'string child inspected']);
    });

    it('keeps output graphs independent across reentrant normalization and shared within one call', () => {
        let nestedCopy: unknown;
        const shared = { value: 1 };
        const source = { a: shared, b: shared };
        const trigger = new Proxy({}, {
            ownKeys(target): Array<string | symbol> {
                nestedCopy = normalizeJsonValue(source);
                return Reflect.ownKeys(target);
            },
        });
        const copy = normalizeJsonValue({ trigger, ...source }) as Record<string, unknown>;
        const nested = nestedCopy as Record<string, unknown>;
        expect(copy.a).toBe(copy.b);
        expect(nested.a).toBe(nested.b);
        expect(copy.a).not.toBe(shared);
        expect(copy.a).not.toBe(nested.a);
        shared.value = 2;
        expect(copy.a).toEqual({ value: 1 });
        expect(nested.a).toEqual({ value: 1 });
    });
});
