import { normalizeJsonValue } from '../packages/core/src/json-value';
import { observedJsonRejection } from './support/observed-json-rejection';

describe('JSON traversal state boundaries', () => {
    it('distinguishes completed aliases from a later active cycle and drains rejections', () => {
        let inspections = 0;
        const shared = new Proxy({ value: 1 }, {
            ownKeys(target): Array<string | symbol> {
                inspections++;
                return Reflect.ownKeys(target);
            },
        });
        const cycle: { self?: unknown } = {};
        cycle.self = cycle;
        const rejected = observedJsonRejection(new Error('late rejection'));
        expect(() => normalizeJsonValue({ a: shared, b: shared, c: cycle, d: rejected.promise }, 'Row.data'))
            .toThrow('Unsupported JSON value at \'Row.data.c.self\' (cyclic reference).');
        expect(inspections).toBe(1);
        expect(rejected.observed()).toBe(true);

        cycle.self = null;
        const recovered = normalizeJsonValue({ a: shared, b: shared, c: cycle }) as Record<string, unknown>;
        expect(recovered.a).toBe(recovered.b);
        expect(recovered.a).not.toBe(shared);
        expect(recovered.c).toEqual({ self: null });
        expect(inspections).toBe(2);
    });

    it('revisits a drained thenable alias without treating it as active or completed', () => {
        let consumed = 0;
        const thenable = {
            then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void {
                consumed++;
                reject(new Error('unsupported thenable'));
            },
        };
        const rejected = observedJsonRejection(new Error('later rejection'));
        expect(() => normalizeJsonValue({ bad: NaN, first: thenable, second: thenable, tail: rejected.promise }, 'Row.data'))
            .toThrow('Unsupported JSON value at \'Row.data.bad\' (NaN).');
        expect(consumed).toBe(2);
        expect(rejected.observed()).toBe(true);
    });

    it('keeps reentrant snapshots independent while retaining aliases within each traversal', () => {
        let entered = false;
        let inner: Record<string, unknown> | undefined;
        const source = { value: 1 };
        const shared = new Proxy(source, {
            getPrototypeOf(target): object | null {
                if (!entered) {
                    entered = true;
                    inner = normalizeJsonValue({ a: shared, b: shared }) as Record<string, unknown>;
                    source.value = 2;
                }
                return Reflect.getPrototypeOf(target);
            },
        });
        const outer = normalizeJsonValue({ a: shared, b: shared }) as Record<string, unknown>;
        expect(inner?.a).toEqual({ value: 1 });
        expect(inner?.a).toBe(inner?.b);
        expect(outer.a).toEqual({ value: 2 });
        expect(outer.a).toBe(outer.b);
        expect(outer.a).not.toBe(inner?.a);
    });

    it('drains repeated unsupported class instances and retains the first diagnostic', () => {
        const rejected = observedJsonRejection(new Error('nested rejection'));
        let inspections = 0;
        class Foreign {
            public nested = rejected.promise;
        }
        const shared = new Proxy(new Foreign(), {
            ownKeys(target): Array<string | symbol> {
                inspections++;
                return Reflect.ownKeys(target);
            },
        });
        expect(() => normalizeJsonValue({ a: shared, b: shared }, 'Row.data'))
            .toThrow('Unsupported JSON value at \'Row.data.a\' (Foreign).');
        expect(inspections).toBe(2);
        expect(rejected.observed()).toBe(true);
    });
});
