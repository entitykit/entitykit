import { toPostgresIndex, toPostgresSequence } from '../packages/postgres/src/postgres-schema-facets';
import type { IndexRow } from '../packages/postgres/src/postgres-introspect-index-query';

function index(overrides: Partial<IndexRow> = {}): IndexRow {
    return {
        table_schema: 'bookshop', table_name: 'books', index_name: 'ix_books_title',
        columns: ['title'], is_unique: false, has_predicate: false, has_expression: false,
        has_included_columns: false, has_non_default_opclass: false, access_method: 'btree',
        is_valid: true, ...overrides,
    };
}

describe('Postgres index and sequence facets', () => {
    it.each([
        ['title', 'title'], ['title', ' title '], ['Order', '"Order"'],
        ['Book"Title', '"Book""Title"'], ['Book,Title', '"Book,Title"'],
    ])('recognizes column %s from its quoted expression %s', (column, expression) => {
        expect(toPostgresIndex(index({ columns: [column], key_parts: [expression] })).keyParts)
            .toEqual([{ kind: 'column', name: column }]);
    });

    it('retains positional expression keys and included columns independently', () => {
        expect(toPostgresIndex(index({
            columns: ['id', null], key_parts: ['id', 'lower(title)'], included_columns: ['edition'],
            predicate: 'price > 0', has_expression: true, has_predicate: true, has_included_columns: true, is_unique: 't',
        }))).toEqual({
            name: 'ix_books_title', columns: ['id'],
            keyParts: [{ kind: 'column', name: 'id' }, { kind: 'expression', expression: 'lower(title)' }],
            includedColumns: ['edition'], filter: 'price > 0', isUnique: true, unsupportedFeatures: undefined,
        });
    });

    it('maps legacy column arrays without inventing expression keys', () => {
        expect(toPostgresIndex(index({ columns: '{title,edition}' })).keyParts)
            .toEqual([{ kind: 'column', name: 'title' }, { kind: 'column', name: 'edition' }]);
        expect(toPostgresIndex(index({ columns: ['title', null], has_expression: true })))
            .toMatchObject({
                columns: ['title'], keyParts: [{ kind: 'column', name: 'title' }],
                unsupportedFeatures: ['expression'],
            });
    });

    it('keeps absent predicate and include metadata absent for a plain index', () => {
        expect(toPostgresIndex(index({ predicate: null }))).toEqual({
            name: 'ix_books_title', columns: ['title'],
            keyParts: [{ kind: 'column', name: 'title' }],
            includedColumns: [], filter: undefined, isUnique: false, unsupportedFeatures: undefined,
        });
    });

    it.each([
        { fields: { has_predicate: 't', predicate: null }, feature: 'partial predicate' },
        { fields: { has_expression: 'YES' }, feature: 'expression' },
        { fields: { has_included_columns: true }, feature: 'included columns' },
        { fields: { has_non_default_opclass: true }, feature: 'non-default operator class' },
        { fields: { access_method: 'gin' }, feature: 'access method \'gin\'' },
        { fields: { is_valid: false }, feature: 'invalid index state' },
    ])('reports missing or unsupported metadata: $feature', ({ fields, feature }) => {
        expect(toPostgresIndex(index(fields)).unsupportedFeatures).toEqual([feature]);
    });

    it('reports multiple unsupported features in stable catalog order', () => {
        expect(toPostgresIndex(index({
            has_predicate: true, has_expression: true, has_included_columns: true,
            has_non_default_opclass: true, access_method: 'hash', is_valid: 'f',
        })).unsupportedFeatures).toEqual([
            'partial predicate', 'expression', 'included columns',
            'non-default operator class', 'access method \'hash\'', 'invalid index state',
        ]);
    });

    it('keeps an explicitly represented operator class expression', () => {
        expect(toPostgresIndex(index({ has_non_default_opclass: true, key_parts: ['title text_pattern_ops'] })))
            .toMatchObject({ keyParts: [{ kind: 'expression', expression: 'title text_pattern_ops' }], unsupportedFeatures: undefined });
    });

    it('preserves exact sequence integers and normalizes catalog cycling', () => {
        expect(toPostgresSequence({
            schemaname: 'Bookshop', sequencename: 'BookNumbers', data_type: 'bigint',
            start_value: '9007199254740993', increment_by: '-2', min_value: '-9223372036854775808',
            max_value: '9223372036854775807', cycle: true, cache_size: '17',
        })).toEqual({
            name: 'BookNumbers', schemaName: 'Bookshop', dataType: 'bigint',
            startValue: '9007199254740993', incrementBy: '-2', minValue: '-9223372036854775808',
            maxValue: '9223372036854775807', isCyclic: true, cache: 17,
        });
    });
});
