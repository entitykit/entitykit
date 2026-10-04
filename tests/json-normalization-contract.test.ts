import { normalizeJsonValue, serializeJsonValue } from '../packages/core/src/json-value';
import {
    createJsonNormalizationState, defineJsonProperty, isJsonArrayIndex,
    jsonArrayLength, jsonChildPropertyPath, rejectJson, withJsonAncestor,
} from '../packages/core/src/json/json-normalization-state';
import { observedJsonRejection } from './support/observed-json-rejection';

describe('exact JSON normalization contracts', () => {
    it.each([
        ['plain', 'Book.metadata.plain'], ['_private', 'Book.metadata._private'],
        ['$value', 'Book.metadata.$value'], ['book42', 'Book.metadata.book42'],
        ['42book', 'Book.metadata["42book"]'], ['book-name', 'Book.metadata["book-name"]'],
        ['book.name', 'Book.metadata["book.name"]'], ['', 'Book.metadata[""]'],
        ['é', 'Book.metadata["é"]'], ['book"name', 'Book.metadata["book\\"name"]'],
        ['book\nname', 'Book.metadata["book\\nname"]'],
    ])('reports the exact path for property %s', (key, path) => {
        expect(() => normalizeJsonValue({ [key]: 1n }, 'Book.metadata')).toThrow(
            `Unsupported JSON value at '${path}' (bigint). JSON properties must contain synchronous JSON-compatible values.`,
        );
    });

    it('formats symbols and numeric property keys without dot syntax', () => {
        expect(jsonChildPropertyPath('Book.metadata', Symbol('hidden')))
            .toBe('Book.metadata[Symbol(hidden)]');
        expect(jsonChildPropertyPath('Book.metadata', 42)).toBe('Book.metadata["42"]');
    });

    it('inspects a shared object once and retains the shared normalized snapshot', () => {
        let inspections = 0;
        const shared = new Proxy({ title: 'A Good Book' }, {
            ownKeys(target) {
                inspections += 1;
                if (inspections > 1) throw new Error('shared metadata inspected twice');
                return Reflect.ownKeys(target);
            },
        });
        const normalized = normalizeJsonValue({ second: shared, first: shared }) as Record<string, unknown>;
        expect(Object.keys(normalized)).toEqual(['first', 'second']);
        expect(normalized.first).toBe(normalized.second);
        expect(normalized.first).not.toBe(shared);
        expect(inspections).toBe(1);
    });

    it('ignores non-enumerable object and array metadata without invoking it', () => {
        const getter = jest.fn((): never => {
            throw new Error('hidden metadata read');
        });
        const object = Object.defineProperty({ title: 'A Good Book' }, 'hidden', { get: getter });
        const array = Object.defineProperty([1, 2], 'hidden', { get: getter });
        expect(normalizeJsonValue(object)).toEqual({ title: 'A Good Book' });
        expect(normalizeJsonValue(array)).toEqual([1, 2]);
        expect(getter).not.toHaveBeenCalled();
    });

    it('keeps the first sorted invalid path while inspecting rejected class fields', () => {
        const rejected = observedJsonRejection(new Error('metadata rejected'));
        class UnsupportedMetadata {
            public nested = rejected.promise;
        }
        const value = Object.defineProperty(new UnsupportedMetadata(), 'hidden', { value: 1n });
        expect(() => normalizeJsonValue({ z: undefined, a: value }, 'Book.metadata'))
            .toThrow('Unsupported JSON value at \'Book.metadata.a\' (UnsupportedMetadata)');
        expect(rejected.observed()).toBe(true);
    });

    it('does not inspect hidden data while draining a refused foreign object', () => {
        const inspected = jest.fn(() => Object.prototype);
        const hidden = new Proxy({}, { getPrototypeOf: inspected });
        class UnsupportedMetadata {}
        const value = Object.defineProperty(new UnsupportedMetadata(), 'hidden', { value: hidden });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow('(UnsupportedMetadata)');
        expect(inspected).not.toHaveBeenCalled();
    });

    it('refuses a hidden symbol on an array and owns its nested rejection', () => {
        const rejected = observedJsonRejection(new Error('symbol metadata failed'));
        const value = Object.defineProperty([1], Symbol('metadata'), { value: rejected.promise });
        expect(() => normalizeJsonValue(value, 'Book.metadata'))
            .toThrow('Unsupported JSON value at \'Book.metadata\' (symbol-keyed property)');
        expect(rejected.observed()).toBe(true);
    });

    it('releases ancestor ownership after failure and preserves the first diagnostic', () => {
        const state = createJsonNormalizationState();
        const value = {};
        const failure = new Error('normalization failed');
        expect(() => withJsonAncestor(value, state, () => {
            expect(state.ancestors.has(value)).toBe(true);
            throw failure;
        })).toThrow(failure);
        expect(state.ancestors.has(value)).toBe(false);
        rejectJson(state, 'Book.metadata.first', 'undefined');
        const original = state.firstError;
        rejectJson(state, 'Book.metadata.second', 'bigint');
        expect(state.firstError).toBe(original);
        expect(original?.message).toBe('Unsupported JSON value at \'Book.metadata.first\' (undefined). JSON properties must contain synchronous JSON-compatible values.');
    });

    it.each([
        ['0', 1, true], ['1', 2, true], ['10', 11, true], ['19', 20, true],
        ['0', 0, false], ['1', 1, false], ['20', 20, false], ['-1', 2, false],
        ['', 2, false], ['01', 2, false], ['1.0', 2, false], ['+1', 2, false],
        ['x1', 2, false], ['1x', 2, false], ['1e0', 2, false], [' 1', 2, false],
        ['9007199254740992', 9007199254740994, false],
        [0, 2, false], [Symbol('0'), 2, false],
    ])('checks array key %s within length %s', (key, length, expected) => {
        expect(isJsonArrayIndex(key, length)).toBe(expected);
    });

    it('reads array length from data descriptors without coercing accessor metadata', () => {
        expect(jsonArrayLength(Object.getOwnPropertyDescriptors([1, 2] as object))).toBe(2);
        expect(jsonArrayLength(Object.getOwnPropertyDescriptors({ length: '2' }))).toBe(0);
        const getter = jest.fn(() => 2);
        expect(jsonArrayLength(Object.getOwnPropertyDescriptors(Object.defineProperty({}, 'length', { get: getter }))))
            .toBe(0);
        expect(getter).not.toHaveBeenCalled();
    });

    it('creates writable and configurable own JSON keys without prototype assignment', () => {
        const target = {};
        defineJsonProperty(target, '__proto__', { title: 'A Good Book' });
        expect(Object.getOwnPropertyDescriptor(target, '__proto__')).toEqual({
            value: { title: 'A Good Book' }, configurable: true, enumerable: true, writable: true,
        });
        expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
        expect(serializeJsonValue(target)).toBe('{"__proto__":{"title":"A Good Book"}}');
    });
});
