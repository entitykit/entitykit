import { sqliteColumnChecks, sqliteGeneratedExpression } from '../packages/sqlite/src/sqlite-ddl-column';
import { parseSqliteIndexSql, parseSqliteTableSql } from '../packages/sqlite/src/sqlite-ddl-parser';

describe('SQLite schema fragment metadata', () => {
    it.each([
        ['"custom ""collation"', 'custom "collation'],
        ['`custom ``collation`', 'custom `collation'],
        ['[custom collation]', 'custom collation'],
    ])('preserves the complete custom collation identifier %s', (quoted, name) => {
        const table = parseSqliteTableSql(`create table data (value text collate ${quoted})`);
        expect(table.columns.get('value')?.collation).toBe(name);
    });

    it('distinguishes table constraints from physical column definitions', () => {
        const table = parseSqliteTableSql(`create table data (
            id integer, owner_id integer, value text,
            primary key (id), unique (value), foreign key (owner_id) references owner(id),
            constraint named_unique unique (owner_id, value),
            check(  id > 0  )
        )`);
        expect([...table.columns.keys()]).toEqual(['id', 'owner_id', 'value']);
        expect(table.checks).toEqual([{ name: 'ck_pulled_1', sql: 'id > 0' }]);
        expect(table.withoutRowId).toBe(false);
    });

    it('keeps quoted SQL keywords in column names out of their facets', () => {
        const table = parseSqliteTableSql(`create table data (
            "collate nocase" text,
            "as (99)" integer,
            "primary key desc" integer,
            "autoincrement" integer
        )`);
        for (const column of table.columns.values()) {
            expect(column).toEqual({
                autoIncrement: false,
                defaultSql: undefined,
                collation: undefined,
                generatedExpression: undefined,
                generatedStored: undefined,
                primaryKeyDescending: false,
            });
        }
    });

    it('ignores unsupported definition prefixes without inventing columns', () => {
        const table = parseSqliteTableSql('create table data (123unknown text, id integer)');
        expect([...table.columns.keys()]).toEqual(['id']);
    });

    it('preserves multiline index predicates and quoted punctuation in expressions', () => {
        expect(parseSqliteIndexSql(`create index ix on data ( id , coalesce(value, 'a,b)') )
            where    id > 0\n                and value is not null`)).toEqual({
            keyParts: [
                { kind: 'column', name: 'id' },
                { kind: 'expression', expression: 'coalesce(value, \'a,b)\')' },
            ],
            filter: 'id > 0\n                and value is not null',
        });
    });

    it('consumes an unterminated trailing SQL comment through the end of the definition', () => {
        expect(parseSqliteIndexSql('create index ix on data (id) where id > 0/*/ ) where false')).toEqual({
            keyParts: [{ kind: 'column', name: 'id' }],
            filter: 'id > 0',
        });
    });

    it('returns no generated expression for an incomplete column fragment', () => {
        expect(sqliteGeneratedExpression('integer as (value + 1')).toBeUndefined();
        expect(sqliteGeneratedExpression('integer as(  value + 1  ) constraint stored_hint check(value > 0)')).toEqual({
            expression: 'value + 1',
            stored: false,
        });
    });

    it('preserves completed column checks when a later check is incomplete', () => {
        expect(sqliteColumnChecks('integer check( value > 0 ) check(value <', () => 'anonymous')).toEqual([
            { name: 'anonymous', sql: 'value > 0' },
        ]);
    });
});
