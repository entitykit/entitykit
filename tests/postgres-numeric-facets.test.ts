import { renderPostgresStoreType } from '../packages/postgres/src/postgres-introspection-values';
import { buildPostgresSchemaSnapshot } from '../packages/postgres/src/postgres-schema-snapshot';
import type { ColumnRow } from '../packages/postgres/src/postgres-introspect-queries';

function numericColumn(overrides: Partial<ColumnRow> = {}): ColumnRow {
    return {
        table_schema: 'bookshop', table_name: 'prices', column_name: 'price', ordinal_position: 1,
        data_type: 'numeric', udt_name: 'numeric', character_maximum_length: null,
        numeric_precision: 10, numeric_scale: 0, is_nullable: 'NO', column_default: null,
        is_identity: 'NO', ...overrides,
    };
}

describe('Postgres numeric precision and signed scale', () => {
    it.each([
        { precision: 10, scale: 0, expected: 'numeric(10,0)' },
        { precision: '10', scale: '0', expected: 'numeric(10,0)' },
        { precision: 2, scale: 2045, expected: 'numeric(2,-3)' },
        { precision: '2', scale: '2045', expected: 'numeric(2,-3)' },
        { precision: 2, scale: -3, expected: 'numeric(2,-3)' },
        { precision: 2, scale: 1048, expected: 'numeric(2,-1000)' },
        { precision: 5, scale: 2047, expected: 'numeric(5,-1)' },
        { precision: 1000, scale: 1000, expected: 'numeric(1000,1000)' },
        { precision: 3, scale: 5, expected: 'numeric(3,5)' },
    ])('preserves precision $precision and catalog scale $scale', ({ precision, scale, expected }) => {
        const column = numericColumn({ numeric_precision: precision, numeric_scale: scale });
        expect(renderPostgresStoreType(column)).toBe(expected);
        const snapshot = buildPostgresSchemaSnapshot([column], [], [], []);
        expect(snapshot.schemas[0]?.tables[0]?.columns[0]?.storeType).toBe(expected);
    });

    it.each([
        { numeric_precision: null, numeric_scale: null },
        { numeric_precision: null, numeric_scale: 2 },
        { numeric_precision: 10, numeric_scale: null },
    ])('keeps an unbounded numeric when a facet is absent: %p', facets => {
        expect(renderPostgresStoreType(numericColumn(facets))).toBe('numeric');
    });

    it.each([
        { data_type: 'smallint', udt_name: 'int2', numeric_precision: 16 },
        { data_type: 'integer', udt_name: 'int4', numeric_precision: 32 },
        { data_type: 'bigint', udt_name: 'int8', numeric_precision: 64 },
    ])('keeps binary precision metadata out of $data_type declarations', column => {
        expect(renderPostgresStoreType(numericColumn(column))).toBe(column.data_type);
    });
});
