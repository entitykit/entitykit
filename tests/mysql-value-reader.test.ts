import fc from 'fast-check';
import { mySqlValueReader } from '../src/providers/mysql/mysql-value-reader';

describe('MySQL value reader', () => {
    it.each([
        [true, true],
        [false, false],
        [1, true],
        [0, false],
        [-1, true],
        [1n, true],
        [0n, false],
        ['1', true],
        ['TRUE', true],
        ['0', false],
        ['false', false],
        ['', false],
        [{}, true],
        [null, false],
    ])('converts %p to boolean %p', (value, expected) => {
        expect(mySqlValueReader.readValue(value, ' BOOLEAN ')).toBe(expected);
        expect(mySqlValueReader.readValue(value, 'tinyint(1)')).toBe(expected);
    });

    it('converts timestamp and datetime representations defensively', () => {
        const date = new Date('2026-07-31T12:00:00.000Z');
        const object = { raw: true };
        const dateLikeObject = { valueOf: () => date.getTime() };

        expect(mySqlValueReader.readValue(date, 'timestamp')).toBe(date);
        expect(mySqlValueReader.readValue(null, 'datetime')).toBeNull();
        expect(mySqlValueReader.readValue(undefined, 'datetime')).toBeUndefined();
        expect(mySqlValueReader.readValue(date.getTime(), 'datetime(6)')).toEqual(date);
        expect(mySqlValueReader.readValue(date.toISOString(), 'TIMESTAMP(6)')).toEqual(date);
        expect(mySqlValueReader.readValue('not-a-date', 'datetime')).toBe('not-a-date');
        expect(mySqlValueReader.readValue(object, 'timestamp')).toBe(object);
        expect(mySqlValueReader.readValue(dateLikeObject, 'timestamp'))
            .toBe(dateLikeObject);
    });

    it('parses JSON-shaped columns without damaging driver-decoded values', () => {
        const decoded = { id: 1 };

        expect(mySqlValueReader.readValue('{"id":1}', 'json')).toEqual(decoded);
        expect(mySqlValueReader.readValue('[1,2]', 'jsonb')).toEqual([1, 2]);
        expect(mySqlValueReader.readValue('["a"]', 'text[]')).toEqual(['a']);
        expect(mySqlValueReader.readValue('invalid', 'json')).toBe('invalid');
        expect(mySqlValueReader.readValue(decoded, 'json')).toBe(decoded);
        const jsonLikeObject = { toString: () => '{"id":2}' };
        expect(mySqlValueReader.readValue(jsonLikeObject, 'json'))
            .toBe(jsonLikeObject);
    });

    it('passes unrecognized column types through unchanged', () => {
        expect(mySqlValueReader.readValue('1', 'varchar(255)')).toBe('1');
        fc.assert(fc.property(fc.anything(), value => {
            expect(mySqlValueReader.readValue(value, 'varchar(255)')).toBe(value);
        }));
    });

    it('preserves JSON values through text round trips', () => {
        fc.assert(fc.property(fc.jsonValue(), value => {
            const serialized = JSON.stringify(value);
            expect(mySqlValueReader.readValue(serialized, 'json'))
                .toEqual(JSON.parse(serialized));
        }));
    });

    it('maps every finite numeric boolean representation by zero-ness', () => {
        fc.assert(fc.property(fc.double({ noNaN: true }), value => {
            expect(mySqlValueReader.readValue(value, 'boolean')).toBe(value !== 0);
        }));
    });
});
