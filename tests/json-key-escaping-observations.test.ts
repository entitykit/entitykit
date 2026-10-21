import { serializeJsonValue } from '../packages/core/src/json-value';

const originalStringify = JSON.stringify;

function isolatedSerialize(work: (serialize: typeof serializeJsonValue) => void): void {
    jest.isolateModules(() => {
        const module = jest.requireActual<{ serializeJsonValue: typeof serializeJsonValue }>(
            '../packages/core/src/json-value',
        );
        work(module.serializeJsonValue);
    });
}

describe('JSON key escaping observations', () => {
    it('does not treat a pre-import application function as a pure native encoder', () => {
        const receivers: unknown[] = [];
        let keys = 0;
        const replacement = function stringify(this: unknown, value: unknown): string {
            receivers.push(this);
            return originalStringify(value === 'a' ? `a_${String(++keys)}` : value);
        };
        Object.defineProperty(replacement, 'toString', {
            value: (): string => 'function stringify() { [native code] }',
        });
        const results: string[] = [];
        JSON.stringify = replacement;
        try {
            isolatedSerialize(serialize => {
                results.push(serialize({ a: 1 }), serialize({ a: 2 }));
            });
        } finally {
            JSON.stringify = originalStringify;
        }

        expect(results).toEqual(['{"a_1":1}', '{"a_2":2}']);
        expect(keys).toBe(2);
        expect(receivers).toEqual([JSON, JSON, JSON, JSON]);
    });

    it('looks up a changing stringify method once per key or scalar emission', () => {
        const descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify');
        if (!descriptor) throw new Error('Missing JSON.stringify descriptor.');
        const receivers: unknown[] = [];
        const calls: number[] = [];
        let reads = 0;
        const results: string[] = [];
        Object.defineProperty(JSON, 'stringify', {
            configurable: true,
            get: (): typeof JSON.stringify => {
                const observed = ++reads;
                return function (this: unknown, value: unknown): string {
                    receivers.push(this);
                    calls.push(observed);
                    return originalStringify(value === 'a' ? `a_${String(observed)}` : value);
                };
            },
        });
        try {
            results.push(serializeJsonValue({ a: 1 }), serializeJsonValue({ a: 2 }));
        } finally {
            Object.defineProperty(JSON, 'stringify', descriptor);
        }

        expect(results).toEqual(['{"a_1":1}', '{"a_3":2}']);
        expect(reads).toBe(4);
        expect(calls).toEqual([1, 2, 3, 4]);
        expect(receivers).toEqual([JSON, JSON, JSON, JSON]);
    });

    it('still observes a getter returning the native method for warmed names', () => {
        serializeJsonValue({ a: 0 });
        const descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify');
        if (!descriptor) throw new Error('Missing JSON.stringify descriptor.');
        let reads = 0;
        const results: string[] = [];
        Object.defineProperty(JSON, 'stringify', {
            configurable: true,
            get: (): typeof JSON.stringify => {
                reads++;
                return originalStringify;
            },
        });
        try {
            results.push(serializeJsonValue({ a: 1 }), serializeJsonValue({ a: 2 }));
        } finally {
            Object.defineProperty(JSON, 'stringify', descriptor);
        }

        expect(results).toEqual(['{"a":1}', '{"a":2}']);
        expect(reads).toBe(4);
    });

    it('propagates a later replacement failure even for a warmed field name', () => {
        serializeJsonValue({ a: 0 });
        const failure = new Error('key escaping refused');
        let keys = 0;
        const results: string[] = [];
        let observed: unknown;
        JSON.stringify = function (value: unknown): string {
            if (value === 'a' && ++keys === 2) throw failure;
            return originalStringify(value);
        };
        try {
            results.push(serializeJsonValue({ a: 1 }));
            serializeJsonValue({ a: 2 });
        } catch (error) {
            observed = error;
        } finally {
            JSON.stringify = originalStringify;
        }

        expect(results).toEqual(['{"a":1}']);
        expect(keys).toBe(2);
        expect(observed).toBe(failure);
    });

    it('uses each observed JSON object as the method receiver', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'JSON');
        if (!descriptor) throw new Error('Missing global JSON descriptor.');
        const receivers: unknown[] = [];
        const method = function (this: unknown, value: unknown): string {
            receivers.push(this);
            return originalStringify(value);
        };
        const first = { stringify: method }, second = { stringify: method };
        let reads = 0;
        let result: string;
        Object.defineProperty(globalThis, 'JSON', {
            configurable: true,
            get: (): object => ++reads % 2 === 1 ? first : second,
        });
        try {
            result = serializeJsonValue({ a: 1 });
        } finally {
            Object.defineProperty(globalThis, 'JSON', descriptor);
        }

        expect(result).toBe('{"a":1}');
        expect(reads).toBe(2);
        expect(receivers).toEqual([first, second]);
    });

    it('preserves pre-import callable Proxy emissions and receivers', () => {
        const receivers: unknown[] = [];
        let keys = 0;
        const results: string[] = [];
        JSON.stringify = new Proxy(originalStringify, {
            apply(target, receiver, args: unknown[]): string {
                receivers.push(receiver);
                return target(args[0] === 'a' ? `a_${String(++keys)}` : args[0]);
            },
        });
        try {
            isolatedSerialize(serialize => {
                results.push(serialize({ a: 1 }), serialize({ a: 2 }));
            });
        } finally {
            JSON.stringify = originalStringify;
        }

        expect(results).toEqual(['{"a_1":1}', '{"a_2":2}']);
        expect(keys).toBe(2);
        expect(receivers).toEqual([JSON, JSON, JSON, JSON]);
    });

    it('preserves escaped UTF-16 keys and lexical numeric order across repeats', () => {
        const key = '\ud800';
        for (let value = 1; value <= 2; value++) {
            expect(serializeJsonValue({ [key]: value, '2': 2, '12': 12 }))
                .toBe(`{"12":12,"2":2,"\\ud800":${String(value)}}`);
            expect(serializeJsonValue({ ['x'.repeat(129)]: value }))
                .toBe(`{"${'x'.repeat(129)}":${String(value)}}`);
        }
    });
});
