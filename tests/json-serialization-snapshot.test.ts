import { normalizeJsonValue, serializeJsonValue } from '../packages/core/src/json-value';
import { observedJsonRejection } from './support/observed-json-rejection';

describe('JSON serialization snapshot boundaries', () => {
    it('keeps empty containers, shared children and lexical numeric keys distinct', () => {
        const child: unknown = JSON.parse('{"2":2,"12":12,"__proto__":{"safe":true}}');
        const source = { z: child, a: [child, {}, []], empty: {} };

        expect(serializeJsonValue(source)).toBe(
            '{"a":[{"12":12,"2":2,"__proto__":{"safe":true}},{},[]],"empty":{},"z":{"12":12,"2":2,"__proto__":{"safe":true}}}',
        );
        const normalized = normalizeJsonValue(source) as typeof source;
        expect(normalized.a[0]).toBe(normalized.z);
        expect(normalized.z).not.toBe(child);
        expect(Array.isArray(normalized.empty)).toBe(false);
        expect(Object.getPrototypeOf(normalized.empty)).toBe(Object.prototype);
    });

    it('finishes source inspection before emission and isolates later source mutations', () => {
        const events: string[] = [];
        const first = { value: 1 }, second = { value: 2 };
        function observed(value: { value: number }, label: string): object {
            return new Proxy(value, {
                getPrototypeOf(target): object | null {
                    events.push(`${label}:prototype`);
                    return Reflect.getPrototypeOf(target);
                },
                ownKeys(target): Array<string | symbol> {
                    events.push(`${label}:keys`);
                    return Reflect.ownKeys(target);
                },
                getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
                    events.push(`${label}:descriptor`);
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
                get(): never {
                    throw new Error('Snapshot inspection must not read a source getter.');
                },
            });
        }
        const source = { z: observed(second, 'z'), a: observed(first, 'a') };
        const stringify = JSON.stringify;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            events.push('emit');
            first.value = 9;
            second.value = 9;
            return stringify(value);
        });
        let result: string;
        try {
            result = serializeJsonValue(source);
        } finally {
            spy.mockRestore();
        }
        expect(events.slice(0, 6)).toEqual([
            'a:prototype', 'a:keys', 'a:descriptor', 'z:prototype', 'z:keys', 'z:descriptor',
        ]);
        expect(events.slice(6)).toEqual(Array<string>(6).fill('emit'));
        expect(result).toBe('{"a":{"value":1},"z":{"value":2}}');
        expect(first.value).toBe(9);
        expect(second.value).toBe(9);
    });

    it('isolates reentrant serialization and emits each shared occurrence', () => {
        const shared = { value: 1 };
        let inspections = 0, entered = false, inner = '', outerValueEmissions = 0;
        const source = new Proxy(shared, {
            ownKeys(target): Array<string | symbol> {
                inspections++;
                return Reflect.ownKeys(target);
            },
        });
        const stringify = JSON.stringify;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            if (value === 'left' && !entered) {
                entered = true;
                shared.value = 8;
                inner = serializeJsonValue({ nested: source });
            }
            if (value === 1) outerValueEmissions++;
            return stringify(value);
        });
        let result: string;
        try {
            result = serializeJsonValue({ right: source, left: source });
        } finally {
            spy.mockRestore();
        }
        expect(result).toBe('{"left":{"value":1},"right":{"value":1}}');
        expect(inner).toBe('{"nested":{"value":8}}');
        expect(inspections).toBe(2);
        expect(outerValueEmissions).toBe(2);
    });

    it('rejects the first invalid property before emission and drains later rejections', () => {
        const rejected = observedJsonRejection(new Error('later rejection'));
        let getterReads = 0, emissions = 0;
        const source = { later: rejected.promise };
        Object.defineProperty(source, 'bad', {
            enumerable: true,
            get: (): number => {
                getterReads++; return 1; 
            },
        });
        const stringify = JSON.stringify;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            emissions++;
            return stringify(value);
        });
        let failure: unknown;
        try {
            serializeJsonValue(source, 'Document.data');
        } catch (error) {
            failure = error;
        } finally {
            spy.mockRestore();
        }
        expect(failure).toBeInstanceOf(TypeError);
        expect((failure as Error).message).toContain('\'Document.data.bad\' (accessor property)');
        expect(getterReads).toBe(0);
        expect(emissions).toBe(0);
        expect(rejected.observed()).toBe(true);
    });

    it.each(['0', '1'])('does not expose object snapshots through inherited array index %s', index => {
        let observations = 0;
        const child = new Proxy({ value: 1 }, {
            getPrototypeOf(target): object | null {
                Object.defineProperty(Array.prototype, index, {
                    configurable: true,
                    get: (): string => {
                        observations++; return 'inherited'; 
                    },
                    set: (): void => {
                        observations++; 
                    },
                });
                return Reflect.getPrototypeOf(target);
            },
        });
        let result: string;
        try {
            result = serializeJsonValue({ b: 2, a: child });
        } finally {
            Reflect.deleteProperty(Array.prototype, index);
        }
        expect(result).toBe('{"a":{"value":1},"b":2}');
        expect(observations).toBe(0);
    });
});
