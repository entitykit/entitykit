import { encodeIdentityTuple } from '../packages/core/src/model/identity-value';

describe('single-scalar identity wire encoding', () => {
    it.each([
        [0, ['number', '0']], [-0, ['number', '-0']],
        [42, ['number', '42']], [-42, ['number', '-42']],
        [1e20, ['number', '100000000000000000000']],
        [1e21, ['number', '1e+21']], [1e-7, ['number', '1e-7']],
        [Number.MIN_VALUE, ['number', '5e-324']],
        [Number.MAX_VALUE, ['number', '1.7976931348623157e+308']],
        [Number.MAX_SAFE_INTEGER, ['number', '9007199254740991']],
        [9007199254740993n, ['bigint', '9007199254740993']],
        [-1n, ['bigint', '-1']], [true, ['boolean', 'true']],
        [false, ['boolean', 'false']], [null, ['null']],
        [undefined, ['undefined']], ['', ['string', '']],
        ['quote" slash\\ newline\n tab\t', ['string', 'quote" slash\\ newline\n tab\t']],
        ['\uD800', ['string', '\uD800']], ['\uDC00', ['string', '\uDC00']],
    ])('keeps the existing type-tagged representation of %p', (value, encoded) => {
        const expected = JSON.stringify(['entitykit:identity:v1', encoded]);
        expect(encodeIdentityTuple([value])).toBe(expected);
        expect(encodeIdentityTuple(Object.freeze([value]))).toBe(expected);
    });

    it('keeps sparse slots distinct from explicit undefined values', () => {
        expect(encodeIdentityTuple(new Array<unknown>(1)))
            .toBe('["entitykit:identity:v1",null]');
        expect(encodeIdentityTuple([undefined]))
            .toBe('["entitykit:identity:v1",["undefined"]]');
    });

    it('retains every value and type in a composite scalar key', () => {
        expect(encodeIdentityTuple([42, 'tenant', false])).toBe(
            '["entitykit:identity:v1",["number","42"],["string","tenant"],["boolean","false"]]',
        );
    });

    it('reads a scalar accessor once through the original array mapping', () => {
        let reads = 0;
        const values = [42];
        Object.defineProperty(values, 0, { get: () => {
            reads++; return reads === 1 ? 42 : 99;
        } });
        expect(encodeIdentityTuple(values)).toBe('["entitykit:identity:v1",["number","42"]]');
        expect(reads).toBe(1);
    });

    it.each(['map', 'constructor'] as const)('retains an own %s getter', property => {
        let reads = 0;
        const values = [42];
        Object.defineProperty(values, property, { get: () => {
            reads++; return property === 'map' ? Array.prototype.map : Array;
        } });
        expect(encodeIdentityTuple(values)).toBe('["entitykit:identity:v1",["number","42"]]');
        expect(reads).toBe(1);
    });

    it('retains custom inherited map behavior', () => {
        const values = [42];
        const prototype: object = Object.create(Array.prototype) as object;
        Object.defineProperty(prototype, 'map', { value: () => {
            throw new Error('custom array mapping');
        } });
        Object.setPrototypeOf(values, prototype);
        expect(() => encodeIdentityTuple(values)).toThrow('custom array mapping');
    });

    it('does not add inspection traps to a proxied array', () => {
        const events: string[] = [];
        const values = new Proxy([42], {
            get: (target, property, receiver): unknown => {
                events.push(`get:${String(property)}`);
                return Reflect.get(target, property, receiver) as unknown;
            },
            getPrototypeOf: target => {
                events.push('prototype'); return Reflect.getPrototypeOf(target);
            },
            getOwnPropertyDescriptor: (target, property) => {
                events.push(`descriptor:${String(property)}`);
                return Reflect.getOwnPropertyDescriptor(target, property);
            },
        });
        expect(encodeIdentityTuple(values)).toBe('["entitykit:identity:v1",["number","42"]]');
        expect(events).toEqual(['get:map', 'get:length', 'get:constructor', 'get:0']);
    });

    it.each([Array.prototype, Object.prototype])('retains inherited JSON hooks on %p', prototype => {
        const original = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
        let result: string;
        Object.defineProperty(prototype, 'toJSON', {
            configurable: true, value: () => ['rewritten'],
        });
        try {
            result = encodeIdentityTuple([42]);
        } finally {
            if (original) Object.defineProperty(prototype, 'toJSON', original);
            else Reflect.deleteProperty(prototype, 'toJSON');
        }
        expect(result).toBe('["rewritten"]');
    });

    it('retains a JSON hook on a custom array-prototype ancestor', () => {
        const original: object | null = Object.getPrototypeOf(Array.prototype) as object | null;
        const ancestor: object = Object.create(original) as object;
        Object.defineProperty(ancestor, 'toJSON', { value: () => 'custom ancestor' });
        let result: string;
        try {
            Object.setPrototypeOf(Array.prototype, ancestor);
            result = encodeIdentityTuple([42]);
        } finally {
            Object.setPrototypeOf(Array.prototype, original);
        }
        expect(result).toBe('"custom ancestor"');
    });
});
