import { normalizeJsonValue } from '../packages/core/src/json-value';
import { observedJsonRejection } from './support/observed-json-rejection';

describe('JSON traversal size boundaries', () => {
    it.each([2, 3, 4, 32])('retains completed aliases and active cycles across %i child objects', count => {
        const input: Record<string, unknown> = {};
        let inspections = 0;
        const shared = new Proxy({ value: 7 }, {
            ownKeys(target): Array<string | symbol> {
                inspections++;
                return Reflect.ownKeys(target);
            },
        });
        input.a = shared;
        for (let i = 1; i < count; i++) input[`child${String(i)}`] = { value: i };
        input.y = shared;
        const result = normalizeJsonValue(input) as Record<string, unknown>;
        expect(result.a).toBe(result.y);
        expect(result.a).not.toBe(shared);
        expect(inspections).toBe(1);
        input.z = input;
        const rejected = observedJsonRejection(new Error('after cycle'));
        input.zz = rejected.promise;
        expect(() => normalizeJsonValue(input, 'Row.data'))
            .toThrow('Unsupported JSON value at \'Row.data.z\' (cyclic reference).');
        expect(inspections).toBe(2);
        expect(rejected.observed()).toBe(true);
    });

    it('does not memoize repeatedly drained parents after many completed children', () => {
        const input: Record<string, unknown> = { a: NaN };
        for (let i = 0; i < 32; i++) input[`child${String(i)}`] = { value: i };
        let consumed = 0;
        const shared = { then(): void {
            consumed++;
        } };
        input.y = shared;
        input.z = shared;
        expect(() => normalizeJsonValue(input, 'Row.data'))
            .toThrow('Unsupported JSON value at \'Row.data.a\' (NaN).');
        expect(consumed).toBe(2);
    });

    it('keeps a large reentrant traversal independent of the outer active graph', () => {
        let inner: Record<string, unknown> | undefined;
        const shared = { value: 1 };
        const large: Record<string, unknown> = { a: shared, z: shared };
        for (let i = 0; i < 32; i++) large[`child${String(i)}`] = { value: i };
        const trigger = new Proxy({}, {
            getPrototypeOf(target): object | null {
                inner = normalizeJsonValue(large) as Record<string, unknown>;
                shared.value = 2;
                return Reflect.getPrototypeOf(target);
            },
        });
        const outer = normalizeJsonValue({ a: trigger, b: shared, c: shared }) as Record<string, unknown>;
        expect(inner?.a).toBe(inner?.z);
        expect(inner?.a).toEqual({ value: 1 });
        expect(outer.b).toBe(outer.c);
        expect(outer.b).toEqual({ value: 2 });
        expect(outer.b).not.toBe(inner?.a);
    });
});
