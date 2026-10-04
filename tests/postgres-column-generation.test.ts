import { postgresColumnGeneration } from '../packages/postgres/src/postgres-column-generation';
import type { ColumnRow } from '../packages/postgres/src/postgres-introspect-queries';

function column(overrides: Partial<ColumnRow> = {}): ColumnRow {
    return {
        table_schema: 'catalog', table_name: 'books', column_name: 'number',
        ordinal_position: 1, data_type: 'bigint', udt_name: 'int8',
        character_maximum_length: null, numeric_precision: 64, numeric_scale: 0,
        is_nullable: 'NO', column_default: null, is_identity: 'NO',
        ...overrides,
    };
}

describe('Postgres store generation metadata', () => {
    it.each(['ALWAYS', 'BY DEFAULT', null, undefined] as const)(
        'preserves identity mode %s ahead of sequence and default metadata', mode => {
            expect(postgresColumnGeneration(column({
                is_identity: 'YES', identity_generation: mode,
                owned_sequence_name: 'owned', column_default: 'nextval(\'fallback\'::regclass)',
            }))).toEqual({
                kind: 'identity', mode: mode === 'ALWAYS' ? 'always' : 'byDefault',
                startValue: undefined, incrementBy: undefined, minValue: undefined,
                maxValue: undefined, isCyclic: false, cache: undefined,
            });
        },
    );

    it.each([null, undefined, '12', 12] as const)(
        'preserves identity scalar and cache value %s', value => {
            const absent = value === null || value === undefined;
            expect(postgresColumnGeneration(column({
                is_identity: 'YES', identity_start: value, identity_increment: value,
                identity_minimum: value, identity_maximum: value, identity_cache: value,
            }))).toMatchObject({
                startValue: absent ? undefined : String(value),
                incrementBy: absent ? undefined : String(value),
                minValue: absent ? undefined : String(value),
                maxValue: absent ? undefined : String(value),
                cache: absent ? undefined : Number(value),
            });
        },
    );

    it('retains zero and negative identity bounds without treating them as absent', () => {
        expect(postgresColumnGeneration(column({
            is_identity: 'YES', identity_start: 0, identity_increment: -2,
            identity_minimum: -50, identity_maximum: 100, identity_cache: 4,
        }))).toMatchObject({
            startValue: '0', incrementBy: '-2', minValue: '-50', maxValue: '100', cache: 4,
        });
    });

    it.each(['YES', 'NO', true, false, null, undefined] as const)(
        'preserves identity cycling %s', cycle => {
            expect(postgresColumnGeneration(column({ is_identity: 'YES', identity_cycle: cycle })))
                .toMatchObject({ isCyclic: cycle === 'YES' || cycle === true });
        },
    );

    it.each([
        ['counter', 'catalog'], [' padded.counter ', ' catalog '],
        ['counter"quote', 'schema.dot'], ['counter\'quote', undefined],
        [' ', ' '], ['counter', null], ['counter', ''],
    ] as const)('preserves owned sequence %s and schema %s without renaming', (name, schema) => {
        expect(postgresColumnGeneration(column({
            owned_sequence_name: name, owned_sequence_schema: schema,
            column_default: 'nextval(\'ignored\'::regclass)',
        }))).toEqual({ kind: 'sequence', name, schemaName: schema === '' ? undefined : schema ?? undefined });
    });

    it.each([
        ['nextval(\'counter\'::regclass)', 'counter', undefined],
        ['  NEXTVAL  (  \'catalog.counter\'::regclass )  ', 'counter', 'catalog'],
        ['nextval(\'"catalog.dot"."counter.dot"\'::regclass)', 'counter.dot', 'catalog.dot'],
        ['nextval(\'"cat""alog"."count""er"\'::regclass)', 'count"er', 'cat"alog'],
        ['nextval(\'catalog.count\'\'er\'::regclass)', 'count\'er', 'catalog'],
        ['nextval(\'" catalog "." counter "\'::regclass)', ' counter ', ' catalog '],
    ] as const)('parses catalog default %s with exact identifier identity', (sql, name, schemaName) => {
        expect(postgresColumnGeneration(column({ column_default: sql })))
            .toEqual({ kind: 'sequence', name, schemaName });
    });

    it.each([
        null, '0', 'gen_random_uuid()', 'nextval(\'counter\')', 'nextval(\'\'::regclass)',
        'catalog.nextval(\'counter\'::regclass)', 'nextval(\'counter\'::regclass) + 100',
    ])(
        'leaves non-sequence default %s intact for ordinary default rendering', sql => {
            expect(postgresColumnGeneration(column({ column_default: sql }))).toBeUndefined();
        },
    );

    it.each([null, undefined, ''])(
        'uses the default when owned sequence metadata is %s', name => {
            expect(postgresColumnGeneration(column({
                owned_sequence_name: name, column_default: 'nextval(\'fallback\'::regclass)',
            }))).toEqual({ kind: 'sequence', name: 'fallback', schemaName: undefined });
        },
    );
});
