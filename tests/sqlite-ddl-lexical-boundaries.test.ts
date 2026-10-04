import { generateDbPullCode } from '../packages/core/src/tooling';
import { SqliteDatabaseConnection, SqliteSchemaIntrospector } from '../packages/sqlite/src';
import { parseSqliteIndexSql, parseSqliteTableSql } from '../packages/sqlite/src/sqlite-ddl-parser';
import { requireDefined } from './support/require-defined';

describe('SQLite DDL lexical boundaries', () => {
    let connection: SqliteDatabaseConnection;

    beforeEach(() => {
        connection = new SqliteDatabaseConnection(':memory:');
    });

    afterEach(async () => {
        await connection.dispose();
    });

    it('preserves column facets and checks across SQL comments', async () => {
        await connection.query({
            text: `create table "commented_metric" (
                "id" integer /* ) , autoincrement */ primary key,
                "name" text /* collate missing check (0) */ collate /* spacing */ nocase,
                "value" integer not null -- ) , "phantom" text
                ,
                "doubled" integer generated always /* ) , */ as ("value" * 2 /* ) , */) /* spacing */ stored,
                constraint "ck_value" /* spacing */ check ("value" >= 0 /* ) , */)
            )`,
            values: [],
        });

        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const table = requireDefined(snapshot.schemas[0].tables[0]);
        expect(table.columns).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'id',
                storeGeneration: { kind: 'rowid', preventReuse: false },
            }),
            expect.objectContaining({ name: 'name', collation: 'nocase' }),
            expect.objectContaining({ name: 'doubled', generatedStored: true }),
        ]));
        expect(table.columns.map(column => column.name)).toEqual(['id', 'name', 'value', 'doubled']);
        expect(table.checkConstraints).toHaveLength(1);
        const check = requireDefined(table.checkConstraints)[0];
        expect(check.name).toBe('ck_value');
        expect(check.sql.trim()).toBe('"value" >= 0');
        expect(table.columns.find(column => column.name === 'doubled')?.generatedExpression?.trim()).toBe('"value" * 2');

        const pulled = generateDbPullCode(snapshot).map(file => file.contents).join('\n');
        expect(pulled).toContain('.useCollation("nocase")');
        expect(pulled).toContain('hasCheckConstraint("ck_value"');
        expect(pulled).not.toContain('missing');
        expect(pulled).not.toContain('phantom');
    });

    it('does not derive constraints or generated columns from SQL string literals', async () => {
        await connection.query({
            text: `create table "literal_metric" (
                "id" integer primary key,
                "label" text default 'collate nocase check (0) as (99) stored constraint ck_pulled_1 check (0)',
                "quoted" text default 'it''s /* not a comment */ -- neither is this ) ,',
                "size" integer as (length("quoted")) virtual,
                check (length("label") > 0)
            )`,
            values: [],
        });

        const table = requireDefined((await new SqliteSchemaIntrospector(connection).introspect()).schemas[0].tables[0]);
        const label = requireDefined(table.columns.find(column => column.name === 'label'));
        expect(label.collation).toBeUndefined();
        expect(label.generatedExpression).toBeUndefined();
        expect(label.generatedStored).toBeUndefined();
        expect(table.checkConstraints).toEqual([{ name: 'ck_pulled_1', sql: 'length("label") > 0' }]);
        expect(table.columns.find(column => column.name === 'quoted')?.defaultSql).toBe(
            '\'it\'\'s /* not a comment */ -- neither is this ) ,\'',
        );
        expect(table.columns.find(column => column.name === 'size')).toEqual(expect.objectContaining({
            generatedExpression: 'length("quoted")',
            generatedStored: false,
        }));
    });

    it('finds table and index bodies beyond quoted names containing SQL punctuation', async () => {
        await connection.query({
            text: `create table "metric (history)" (
                "id" integer primary key,
                "name" text collate nocase,
                "value" integer,
                constraint "ck""value" check ("value" >= 0)
            ) without /* comment with ) , */ rowid`,
            values: [],
        });
        await connection.query({
            text: `create index "ix on (history)" on "metric (history)"
                ("name" /* , hidden */, coalesce("name", 'a,b)'))
                /* where false */ where "value" > 0`,
            values: [],
        });

        const snapshot = await new SqliteSchemaIntrospector(connection).introspect();
        const table = requireDefined(snapshot.schemas[0].tables[0]);
        expect(table.columns.find(column => column.name === 'id')?.isStoreGenerated).toBe(false);
        expect(table.columns.find(column => column.name === 'name')?.collation).toBe('nocase');
        expect(table.checkConstraints).toEqual([{ name: 'ck"value', sql: '"value" >= 0' }]);
        expect(table.indexes).toContainEqual(expect.objectContaining({
            name: 'ix on (history)',
            keyParts: [
                { kind: 'column', name: 'name' },
                { kind: 'expression', expression: 'coalesce("name", \'a,b)\')' },
            ],
            filter: '"value" > 0',
            unsupportedFeatures: undefined,
        }));
        const pulled = generateDbPullCode(snapshot).map(file => file.contents).join('\n');
        expect(pulled).toContain('hasCheckConstraint("ck\\"value"');
        expect(pulled).toContain('.hasFilter("\\"value\\" > 0")');
    });

    it.each([
        ['double quotes', '"key ""id"', 'key "id', '"ck ""label"', 'ck "label', '"nocase"'],
        ['backticks', '`key ``id`', 'key `id', '`ck ``label`', 'ck `label', '`nocase`'],
        ['brackets', '[key id]', 'key id', '[ck label]', 'ck label', '[nocase]'],
        ['unquoted names', 'key$id', 'key$id', 'ck_label', 'ck_label', 'nocase'],
    ])('preserves %s and reserves genuine names for anonymous checks', async (
        _style, identifier, name, checkIdentifier, checkName, collation,
    ) => {
        await connection.query({
            text: `create table quoted_values (
                ${identifier} integer primary key autoincrement,
                label text default 'collate binary' collate ${collation}
                    constraint    ${checkIdentifier}    check(  length(label) > 0  )
                    check(  label != 'constraint ck_pulled_1 check (0)'  ),
                amount integer default (1) check(  amount between 0 and 10  ),
                constraint    ck_pulled_1    check(  amount >= 0  ),
                constraint    ck_pulled_2    check(  amount <= 10  ),
                constraint ${checkIdentifier.replace('ck', 'table_ck')} check( amount <= 100 )
            )`,
            values: [],
        });
        await connection.query({ text: `create index ix_quoted_values on quoted_values (${identifier}, label)`, values: [] });

        const table = requireDefined((await new SqliteSchemaIntrospector(connection).introspect()).schemas[0].tables[0]);
        expect(table.columns.find(column => column.name === name)?.storeGeneration).toEqual({ kind: 'rowid', preventReuse: true });
        expect(table.columns.find(column => column.name === 'label')?.collation).toBe('nocase');
        expect(table.checkConstraints).toEqual([
            { name: checkName, sql: 'length(label) > 0' },
            { name: 'ck_pulled_3', sql: 'label != \'constraint ck_pulled_1 check (0)\'' },
            { name: 'ck_pulled_4', sql: 'amount between 0 and 10' },
            { name: 'ck_pulled_1', sql: 'amount >= 0' },
            { name: 'ck_pulled_2', sql: 'amount <= 10' },
            { name: checkName.replace('ck', 'table_ck'), sql: 'amount <= 100' },
        ]);
        expect(table.indexes).toContainEqual(expect.objectContaining({
            name: 'ix_quoted_values',
            keyParts: [{ kind: 'column', name }, { kind: 'column', name: 'label' }],
            filter: undefined,
        }));
    });

    it('ignores literal markers immediately following comments and trailing comment text', async () => {
        await connection.query({
            text: `create table adjacent_comments (
                id integer primary key,
                label text default/* ) , */'collate nocase check(0) as (99)',
                note text default-- ) ,\n'collate binary check(0) as (98)'
            )`,
            values: [],
        });
        await connection.query({
            text: 'create index ix_adjacent_comments on adjacent_comments (label) where label is not null -- , )',
            values: [],
        });
        const table = requireDefined((await new SqliteSchemaIntrospector(connection).introspect()).schemas[0].tables[0]);
        expect(table.checkConstraints).toEqual([]);
        for (const name of ['label', 'note']) {
            const column = requireDefined(table.columns.find(value => value.name === name));
            expect(column.collation).toBeUndefined();
            expect(column.generatedExpression).toBeUndefined();
        }
        expect(table.indexes[0].filter).toBe('label is not null');
    });

    it.each([undefined, '', 'create table unfinished', 'create table unfinished (id integer']) (
        'returns no invented table facets for incomplete DDL %s', sql => {
            expect(parseSqliteTableSql(sql)).toEqual({ columns: new Map(), checks: [], withoutRowId: false });
        },
    );

    it.each([undefined, '', 'create index unfinished', 'create index unfinished (id)', 'create index unfinished on item (id']) (
        'returns no invented index facets for incomplete DDL %s', sql => {
            expect(parseSqliteIndexSql(sql)).toEqual({});
        },
    );
});
