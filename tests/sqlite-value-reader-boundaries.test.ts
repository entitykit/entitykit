import { sqliteValueReader } from '../packages/sqlite/src';

describe('SQLite value reader boundaries', () => {
    it('preserves already normalized JSON and date identities', () => {
        const date = new Date('2026-01-02T03:04:05.000Z');
        const json = { nested: ['value'] };
        const array = [json];
        const numericArray = [1];

        expect(sqliteValueReader.readValue(date, 'TIMESTAMP')).toBe(date);
        expect(sqliteValueReader.readValue(json, 'jsonb')).toBe(json);
        expect(sqliteValueReader.readValue(array, 'text[]')).toBe(array);
        expect(sqliteValueReader.readValue(numericArray, 'jsonb')).toBe(numericArray);
        expect(sqliteValueReader.readValue(false, 'json')).toBe(false);
        expect(sqliteValueReader.readValue(42, 'json')).toBe(42);
    });

    it('converts bigint epochs and date type facets while preserving invalid text', () => {
        const epoch = 1767323045000n;
        const expected = new Date(Number(epoch));
        expect(sqliteValueReader.readValue(epoch, 'timestamp')).toEqual(expected);
        expect(sqliteValueReader.readValue(expected.toISOString(), ' DATETIME(3) ')).toEqual(expected);
        expect(sqliteValueReader.readValue('invalid', 'timestamp')).toBe('invalid');
    });

    it('leaves unsupported date inputs unchanged without coercing them', () => {
        const opaque = {
            toString: (): never => {
                throw new Error('unexpected coercion');
            },
        };
        expect(sqliteValueReader.readValue(opaque, 'datetime')).toBe(opaque);
        expect(sqliteValueReader.readValue(false, 'datetime')).toBe(false);
    });

    it('preserves boolean storage rules across primitive and opaque values', () => {
        const cases: Array<[unknown, boolean]> = [
            [true, true], [false, false], [0n, false], [-2n, true],
            [0, false], [-0, false], [Number.NaN, true], [-1, true],
            ['', false], ['TRUE', true], ['1', true], ['false', false],
            [null, false], [undefined, false], [{}, true],
        ];
        for (const [value, expected] of cases) {
            expect(sqliteValueReader.readValue(value, 'boolean')).toBe(expected);
        }
    });
});
