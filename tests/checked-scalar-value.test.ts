import { isCheckedScalarValue } from '../packages/core/src/materialization/checked-scalar-value';

describe('mapped scalar representations', () => {
    it.each([
        [' TEXT ', 'Ada', true], ['varchar(40)', 'Ada', true], ['text', 1, false],
        ['uuid', {}, false], ['integer', 1, true], ['int4', 1.5, false],
        ['int', Number.MAX_SAFE_INTEGER + 1, false], ['real', 1.5, true],
        ['double precision', Infinity, false], ['float8', NaN, false],
        ['boolean', false, true], ['bool', 1, false],
        ['timestamp with time zone', new Date(0), true], ['timestamptz', new Date(NaN), false],
        ['timestamptz(0)', new Date(0), true], ['timestamptz(3)', new Date(123), true],
        ['timestamptz(6)', new Date(123), true], [' TIMESTAMPTZ(3) ', new Date(123), true],
        ['timestamptz(3)', new Date(NaN), false], ['timestamptz(3)', '2026-10-04', false],
        ['timestamptz(3)', 123, false],
        ['datetime(6)', '2026-01-01', false], ['bytea', new Uint8Array([1]), true],
        ['blob', [1, 2], false], ['varbinary(10)', new Uint8Array(), true],
        ['char', 'Ada', true], ['character varying', 'Ada', true],
        ['binary', new Uint8Array([1]), true], ['varbinary', new Uint8Array(), true],
        ['datetime', new Date(0), true], ['timestamp(03)', new Date(123), true],
        ['timestamptz(03)', new Date(123), true], ['datetime(03)', new Date(123), true],
        ['timestamp   without\t time zone', new Date(0), true],
    ])('checks %s values without coercing them', (type, value, valid) => {
        expect(isCheckedScalarValue(value, type)).toBe(valid);
    });

    it.each(['bigint', 'numeric', 'decimal(10,2)', 'date', 'json', 'text[]', 'custom_domain',
        'timestamptz()', 'timestamptz(three)', 'timestamptz(3) trailing', 'prefix timestamptz(3)',
        'timestamp(three)', 'prefix text', 'integer suffix', 'prefix real', 'real suffix',
        'prefix boolean', 'boolean suffix', 'prefix blob', 'blob suffix'])(
        'requires an explicit guard for %s', type => {
            expect(isCheckedScalarValue('1', type)).toBeUndefined();
        },
    );
});
