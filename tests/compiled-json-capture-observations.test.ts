import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { entityReadMetadata } from './support/compiled-entity';

describe.each([false, true])('JSON capture observations, compiled=%s', compiled => {
    function capture(value: unknown): ReturnType<typeof captureMaterializedValues> {
        return captureMaterializedValues(entityReadMetadata(compiled, undefined, 'json'), {
            id: 1, stored_value: value, tail: 2,
        });
    }

    it('observes getter-backed provider values separately for model and bound snapshots', () => {
        let reads = 0;
        const source = { get child(): { read: number } {
            return { read: ++reads };
        } };
        const captured = capture(source);
        expect(reads).toBe(2);
        expect(captured.values.value).toEqual({ child: { read: 1 } });
        expect(captured.boundValues.value).toBe('{"child":{"read":2}}');
    });

    it('preserves both custom array iterator observations', () => {
        let iterations = 0;
        const source = [10];
        Object.defineProperty(source, Symbol.iterator, {
            value: function* (): Generator<number> {
                yield ++iterations;
            },
        });
        const captured = capture(source);
        expect(iterations).toBe(2);
        expect(captured.values.value).toEqual([1]);
        expect(captured.boundValues.value).toBe('[2]');
        expect(source[0]).toBe(10);
    });

    it('keeps proxy source enumeration separate from normalized snapshot inspection', () => {
        let enumerations = 0, reads = 0;
        const source = new Proxy({ value: 1 }, {
            ownKeys(target): Array<string | symbol> {
                enumerations++;
                return Reflect.ownKeys(target);
            },
            get(target, key, receiver): unknown {
                if (key === 'value') reads++;
                return Reflect.get(target, key, receiver) as unknown;
            },
        });
        const captured = capture(source);
        expect(enumerations).toBe(2);
        expect(reads).toBe(2);
        expect(captured.values.value).toEqual({ value: 1 });
        expect(captured.boundValues.value).toBe('{"value":1}');
    });

    it('isolates captured values from source mutation during encoding', () => {
        const source = { items: [1] };
        const stringify = JSON.stringify;
        let observations = 0;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            if (value === 'items') {
                observations++;
                source.items[0] = 99;
                source.items.push(100);
            }
            return stringify(value);
        });
        let captured: ReturnType<typeof captureMaterializedValues>;
        try {
            captured = capture(source);
        } finally {
            spy.mockRestore();
        }
        expect(observations).toBe(1);
        expect(captured.boundValues.value).toBe('{"items":[1]}');
        expect(captured.values.value).toEqual({ items: [1] });
        expect(source).toEqual({ items: [99, 100] });
    });

    it('completes source cloning before validating invalid JSON values', () => {
        let reads = 0;
        const source = {
            invalid: NaN,
            get later(): never {
                reads++;
                throw new Error('late source getter');
            },
        };
        expect(() => capture(source)).toThrow('late source getter');
        expect(reads).toBe(1);
    });

    it('finishes both source traversals before primitive JSON emission', () => {
        const events: string[] = [];
        let observation = 0;
        const source = {
            get a(): number {
                events.push('a');return ++observation;
            },
            get b(): number {
                events.push('b');return ++observation;
            },
        };
        const stringify = JSON.stringify;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            events.push('emit');return stringify(value);
        });
        let captured: ReturnType<typeof captureMaterializedValues>;
        try {
            captured = capture(source);
        } finally {
            spy.mockRestore();
        }
        expect(events).toEqual(['a', 'b', 'a', 'b', 'emit', 'emit', 'emit', 'emit']);
        expect(captured.values.value).toEqual({ a: 1, b: 2 });
        expect(captured.boundValues.value).toBe('{"a":3,"b":4}');
    });

    it('preserves null-prototype model values, special keys and shared child aliases', () => {
        const shared = { nested: [1] };
        const source = Object.create(null) as Record<string, unknown>;
        source.left = shared;source.right = shared;source.__proto__ = { safe: true };
        const captured = capture(source);
        const model = captured.values.value as typeof source;
        expect(Object.getPrototypeOf(model)).toBeNull();
        expect(Object.hasOwn(model, '__proto__')).toBe(true);
        expect(model.left).toBe(model.right);
        expect(model.left).not.toBe(shared);
        expect(captured.boundValues.value).toBe('{"__proto__":{"safe":true},"left":{"nested":[1]},"right":{"nested":[1]}}');
        shared.nested.push(9);
        expect(model.left).toEqual({ nested: [1] });
    });
});
