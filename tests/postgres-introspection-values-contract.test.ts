import { normalizePostgresBoolean, normalizePostgresStringArray, renderPostgresStoreType } from '../packages/postgres/src/postgres-introspection-values';
import type { ColumnRow } from '../packages/postgres/src/postgres-introspect-queries';

function column(overrides: Partial<ColumnRow>): ColumnRow {
    return {
        table_schema: 'bookshop', table_name: 'books', column_name: 'title', ordinal_position: 1,
        data_type: 'text', udt_name: 'text', character_maximum_length: null,
        numeric_precision: null, numeric_scale: null, is_nullable: 'YES', column_default: null,
        is_identity: 'NO', ...overrides,
    };
}

describe('Postgres catalog value normalization', () => {
    it.each([true, 't', 'true', 'YES', 'yes', '1'])('accepts catalog true %p', value => {
        expect(normalizePostgresBoolean(value)).toBe(true);
    });
    it.each([false, 'f', 'false', 'NO', 'no', '0', '', 'True', 'T', 1, 0, null, undefined])('does not treat %p as true', value => {
        expect(normalizePostgresBoolean(value)).toBe(false);
    });
    it('preserves quoted and punctuated native array values', () => {
        const input = ['Book,Title', 'Book"Title', 'éditions', ''];
        const result = normalizePostgresStringArray(input);
        expect(result).toEqual(input);
        expect(result).not.toBe(input);
    });
    it.each([
        ['{title,edition}', ['title', 'edition']], ['{}', []], ['', []],
        [null, []], [undefined, []], [42, []],
    ])('handles the legacy string-array representation %p', (input, expected) => {
        expect(normalizePostgresStringArray(input)).toEqual(expected);
    });

    it.each([
        ['_bpchar', 'character[]'], ['_bool', 'boolean[]'], ['_float4', 'real[]'],
        ['_float8', 'double precision[]'], ['_int2', 'smallint[]'], ['_int4', 'integer[]'],
        ['_int8', 'bigint[]'], ['_timestamptz', 'timestamp with time zone[]'],
        ['_timetz', 'time with time zone[]'], ['_varchar', 'varchar[]'],
        ['_uuid', 'uuid[]'], ['_text', 'text[]'], ['int4', 'integer[]'],
    ])('renders array element %s as %s', (udt_name, expected) => {
        expect(renderPostgresStoreType(column({ data_type: 'ARRAY', udt_name }))).toBe(expected);
    });

    it.each([
        { data_type: 'character varying', udt_name: 'varchar', character_maximum_length: 255, expected: 'varchar(255)' },
        { data_type: 'varchar', udt_name: 'varchar', character_maximum_length: '32', expected: 'varchar(32)' },
        { data_type: 'character varying', udt_name: 'varchar', expected: 'character varying' },
        { data_type: 'USER-DEFINED', udt_name: 'BookEdition', expected: 'BookEdition' },
        { data_type: 'text', udt_name: 'text', expected: 'text' },
        { data_type: 'real', udt_name: 'float4', numeric_precision: 24, numeric_scale: null, expected: 'real' },
        { data_type: 'double precision', udt_name: 'float8', numeric_precision: 53, numeric_scale: null, expected: 'double precision' },
        { data_type: 'decimal', udt_name: 'numeric', numeric_precision: 5, numeric_scale: 0, expected: 'decimal(5,0)' },
    ])('retains the declaration for $data_type', ({ expected, ...facets }) => {
        expect(renderPostgresStoreType(column(facets))).toBe(expected);
    });
});
