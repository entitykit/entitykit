import {
    materializeProjectionRows,
    type ProjectionFieldReader,
} from '../packages/core/src/core/projection-row-materializer';
import { createQueryModel } from '../packages/core/src/query/query-model';
import type { ProjectionExpression } from '../packages/core/src/query/projection';

function project(
    projection: readonly ProjectionExpression[],
    row: Record<string, unknown>,
    read: ProjectionFieldReader = (_source, _property, value) => value,
): Record<string, unknown> {
    const model = { ...createQueryModel(class Row {}), projection };
    const result = materializeProjectionRows(model, [row], read)[0];
    return result;
}

function field(alias: string, path?: readonly string[]): ProjectionExpression {
    return { kind: 'field', alias, propertyName: alias, path };
}

describe('projection result ownership', () => {
    it.each(['ordinary', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
        'returns a plain object with an own writable data property for %s', alias => {
            const result = project([field(alias)], { [alias]: 42 });
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            expect(Object.getOwnPropertyDescriptor(result, alias)).toEqual({
                value: 42, configurable: true, enumerable: true, writable: true,
            });
            expect(JSON.stringify(result)).toBe(JSON.stringify({ [alias]: 42 }));
        },
    );

    it('bypasses an inherited non-writable property', () => {
        const key = '__entitykitProjectionReadonly';
        Object.defineProperty(Object.prototype, key, {
            configurable: true, value: 'inherited', writable: false,
        });
        try {
            const result = project([field(key)], { [key]: 42 });
            expect(Object.getOwnPropertyDescriptor(result, key)).toEqual({
                value: 42, configurable: true, enumerable: true, writable: true,
            });
        } finally {
            Reflect.deleteProperty(Object.prototype, key);
        }
    });

    it('bypasses an inherited accessor installed during field conversion', () => {
        const key = '__entitykitProjectionAccessor';
        let calls = 0;
        try {
            const result = project([field('raw', [key])], { raw: 42 }, (_source, _name, value) => {
                Object.defineProperty(Object.prototype, key, {
                    configurable: true,
                    get: () => {
                        calls++; return 'inherited';
                    },
                    set: () => {
                        calls++;
                    },
                });
                return value;
            });
            expect(calls).toBe(0);
            expect(Object.getOwnPropertyDescriptor(result, key)?.value).toBe(42);
        } finally {
            Reflect.deleteProperty(Object.prototype, key);
        }
    });

    it('retains define semantics and write order on an externally supplied nested object', () => {
        let setterCalls = 0;
        const nested = {};
        Object.defineProperty(nested, 'value', {
            configurable: true,
            get: () => 'before',
            set: () => {
                setterCalls++;
            },
        });
        const order: string[] = [];
        const result = project([
            field('scope'), field('next', ['scope', 'value']), field('last'),
        ], { scope: nested, next: 42, last: 43 }, (_source, name, value) => {
            order.push(name);
            if (name === 'last') expect(Reflect.get(nested, 'value')).toBe(42);
            return value;
        });
        expect(order).toEqual(['scope', 'next', 'last']);
        expect(result.scope).toBe(nested);
        expect(setterCalls).toBe(0);
        expect(Object.getOwnPropertyDescriptor(nested, 'value')).toEqual({
            value: 42, configurable: true, enumerable: true, writable: true,
        });
    });

    it('rejects replacement of a protected nested property', () => {
        const nested = Object.freeze({ value: 'before' });
        expect(() => project([
            field('scope'), field('next', ['scope', 'value']),
        ], { scope: nested, next: 'after' })).toThrow(TypeError);
        expect(nested.value).toBe('before');
    });

    it('keeps insertion order and data descriptors when a later field replaces a root value', () => {
        const result = project([
            field('first', ['value']), field('middle'), field('last', ['value']),
        ], { first: 1, middle: 2, last: 3 });
        expect(Object.keys(result)).toEqual(['value', 'middle']);
        expect(result).toEqual({ value: 3, middle: 2 });
        expect(Object.getOwnPropertyDescriptor(result, 'value')).toEqual({
            value: 3, configurable: true, enumerable: true, writable: true,
        });
    });
});
