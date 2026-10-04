import {
    encodeIdentityTuple,
    formatIdentityValue,
} from '../packages/core/src/model/identity-value';

describe('identity values at the tracking boundary', () => {
    it('keeps empty, nullish, nested and signed-zero identities distinct', () => {
        const identities = [[], [null], [undefined], [0], [-0], [[]], [{}], ['undefined']];
        expect(new Set(identities.map(encodeIdentityTuple)).size).toBe(identities.length);
    });

    it('normalizes object key order while preserving nested types', () => {
        const first = { a: [1n, false], b: { id: '1' } };
        const second = { b: { id: '1' }, a: [1n, false] };
        const different = { a: [1n, false], b: { id: 1 } };
        expect(encodeIdentityTuple([first])).toBe(encodeIdentityTuple([second]));
        expect(encodeIdentityTuple([first])).not.toBe(encodeIdentityTuple([different]));
    });

    it('accepts null-prototype records and repeated acyclic references', () => {
        const shared = { id: 1 };
        const plain = { first: shared, second: shared };
        const record = Object.assign(Object.create(null) as object, plain);
        expect(encodeIdentityTuple([record])).toBe(encodeIdentityTuple([plain]));
        expect(encodeIdentityTuple([shared, shared]))
            .toBe(encodeIdentityTuple([{ id: 1 }, { id: 1 }]));
    });

    it.each([NaN, Infinity, -Infinity])('refuses a non-finite number %p', value => {
        expect(() => encodeIdentityTuple([value])).toThrow('Identity numbers must be finite.');
    });

    it('refuses an invalid Date instead of creating a colliding identity', () => {
        expect(() => encodeIdentityTuple([new Date(NaN)]))
            .toThrow('Identity dates must be valid.');
        expect(formatIdentityValue(new Date(NaN))).toBe('Date(Invalid)');
    });

    it.each([
        [Symbol('id'), 'symbol'],
        [(): number => 1, 'function'],
        [new Map(), 'Map'],
        [new Set(), 'Set'],
        [/id/, 'RegExp'],
    ])('refuses an unsupported identity %p with its type', (value, type) => {
        expect(() => encodeIdentityTuple([value]))
            .toThrow(`Unsupported identity value (${type}).`);
    });

    it('refuses direct and indirect cycles without treating shared branches as cycles', () => {
        const array: unknown[] = [];
        array.push(array);
        const direct: { self?: object } = {};
        direct.self = direct;
        const indirect: { next?: object } = {};
        indirect.next = { previous: indirect };
        for (const value of [array, direct, indirect]) {
            expect(() => encodeIdentityTuple([value]))
                .toThrow('Identity values cannot contain cyclic references.');
        }
    });

    it.each([
        [null, 'null'], [undefined, 'undefined'], [true, 'true'], [42, '42'],
        [1n, '1'], [Symbol('id'), 'Symbol(id)'], ['key', 'key'],
        [new Date(0), '1970-01-01T00:00:00.000Z'],
        [new Uint8Array([0, 15, 255]), '0x000fff'],
    ])('formats scalar identity %p for diagnostics', (value, expected) => {
        expect(formatIdentityValue(value)).toBe(expected);
    });

    it('formats structured and callable identities without generic object coercion', () => {
        expect(formatIdentityValue([1, 'a'])).toBe(encodeIdentityTuple([1, 'a']));
        expect(formatIdentityValue({ id: 1 })).toBe(encodeIdentityTuple([{ id: 1 }]));
        expect(formatIdentityValue(function identifier(): number {
            return 1; 
        })).toBe('identifier');
        expect(formatIdentityValue((): number => 1)).toBe('function');
    });
});
