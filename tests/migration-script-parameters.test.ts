import type { SqlStatement } from '../src';
import type { SqlDialect } from '../src/adapter';
import { renderScript } from '../src/migrations/api';
import { mySqlDialect } from '../src/providers/mysql/mysql-dialect';
import { sqliteDialect } from '../src/providers/sqlite/sqlite-dialect';
import { postgresDialect } from '../src/sql/postgres-dialect';

function render(
    text: string,
    values: readonly unknown[],
    dialect: SqlDialect = postgresDialect,
): string {
    return renderScript([{ text, values } satisfies SqlStatement], dialect);
}

describe('migration script parameters', () => {
    it('keeps numbered placeholder identity when references repeat or arrive out of order', () => {
        expect(render('select $2, $1, $2', ['first', 'second']))
            .toBe('select \'second\', \'first\', \'second\';');
    });

    it('does not mistake dollar signs inside unquoted identifiers for parameters or quotes', () => {
        expect(render('select foo$tag$, foo$1, $1', ['live']))
            .toBe('select foo$tag$, foo$1, \'live\';');
    });

    it('replaces anonymous placeholders positionally for SQLite and MySQL', () => {
        expect(render('select ?, ?, ?', ['first', 2, true], sqliteDialect))
            .toBe('select \'first\', 2, 1;');
        expect(render('select ?, ?, ?', ['first', 2, true], mySqlDialect))
            .toBe('select \'first\', 2, true;');
    });

    it('leaves placeholders in quoted text and comments untouched', () => {
        const questionSql = [
            'select \'?\' as "?", `?`, ? -- ?',
            '/* outer ? /* nested ? */ still ? */',
            '# ?',
            'select 1',
        ].join('\n');
        expect(render(questionSql, ['live'], mySqlDialect)).toBe([
            'select \'?\' as "?", `?`, \'live\' -- ?',
            '/* outer ? /* nested ? */ still ? */',
            '# ?',
            'select 1;',
        ].join('\n'));

        const numberedSql = [
            'select \'$1\', "$2", $1 -- $3',
            '/* $4 */',
        ].join('\n');
        expect(render(numberedSql, ['live'])).toBe([
            'select \'$1\', "$2", \'live\' -- $3',
            '/* $4 */;',
        ].join('\n'));
    });

    it('applies each dialect\'s backslash quote rules', () => {
        expect(render(String.raw`select 'C:\', ?`, ['live'], sqliteDialect))
            .toBe(String.raw`select 'C:\', 'live';`);
        expect(render(String.raw`select 'C:\', $1`, ['live']))
            .toBe(String.raw`select 'C:\', 'live';`);
        expect(render(String.raw`select E'it\'s $2', $1`, ['live']))
            .toBe(String.raw`select E'it\'s $2', 'live';`);
    });

    it('leaves PostgreSQL dollar-quoted bodies untouched', () => {
        const sql = [
            'do $entitykit$',
            'begin',
            '  perform \'$1\';',
            '  perform $2;',
            'end',
            '$entitykit$;',
            'select $1;',
            'select $$ $2 ? $$',
        ].join('\n');

        expect(render(sql, ['live'])).toBe([
            'do $entitykit$',
            'begin',
            '  perform \'$1\';',
            '  perform $2;',
            'end',
            '$entitykit$;',
            'select \'live\';',
            'select $$ $2 ? $$;',
        ].join('\n'));
    });

    it.each([
        {
            name: 'Postgres',
            dialect: postgresDialect,
            text: 'select $1, $2, $3, $4, $5, $6, $7, $8',
            expected: 'select null, \'O\'\'Brien\', true, 42.5, 9007199254740993, \'2026-01-02T03:04:05.678Z\', \'{"nested":["x",1]}\', decode(\'00abff\', \'hex\');',
        },
        {
            name: 'SQLite',
            dialect: sqliteDialect,
            text: 'select ?, ?, ?, ?, ?, ?, ?, ?',
            expected: 'select null, \'O\'\'Brien\', 1, 42.5, 9007199254740993, \'2026-01-02T03:04:05.678Z\', \'{"nested":["x",1]}\', X\'00abff\';',
        },
        {
            name: 'MySQL',
            dialect: mySqlDialect,
            text: 'select ?, ?, ?, ?, ?, ?, ?, ?',
            expected: 'select null, \'O\'\'Brien\', true, 42.5, 9007199254740993, \'2026-01-02 03:04:05.678\', \'{"nested":["x",1]}\', X\'00abff\';',
        },
    ])('renders supported values with $name bind semantics', ({ dialect, text, expected }) => {
        expect(render(text, [
            null,
            'O\'Brien',
            true,
            42.5,
            9007199254740993n,
            new Date('2026-01-02T03:04:05.678Z'),
            { nested: ['x', 1] },
            Uint8Array.from([0, 171, 255]),
        ], dialect)).toBe(expected);
    });

    it('renders MySQL control characters independently of backslash SQL mode', () => {
        expect(render('select ?', ['C:\\temp\nO\'Brien'], mySqlDialect))
            .toBe('select CONVERT(X\'433a5c74656d700a4f27427269656e\' USING utf8mb4);');
    });

    it('handles zero bytes only where the provider can represent them as text', () => {
        expect(render('select ?', ['a\0b'], sqliteDialect))
            .toBe('select CAST(X\'610062\' AS TEXT);');
        expect(render('select ?', ['a\0b'], mySqlDialect))
            .toBe('select CONVERT(X\'610062\' USING utf8mb4);');
        expect(() => render('select $1', ['a\0b']))
            .toThrow('strings containing a zero byte');
    });

    it('validates anonymous placeholder and value cardinality', () => {
        expect(() => render('select ?, ?', ['one'], sqliteDialect))
            .toThrow('found 2 \'?\' placeholders for 1 values');
        expect(() => render('select ?', ['one', 'two'], sqliteDialect))
            .toThrow('found 1 \'?\' placeholders for 2 values');
        expect(render('select \'?\'', [], sqliteDialect)).toBe('select \'?\';');
    });

    it('validates the complete numbered placeholder range', () => {
        expect(() => render('select $2', ['one', 'two']))
            .toThrow('expected $1 through $2, but found $2');
        expect(() => render('select $1', ['one', 'two']))
            .toThrow('expected $1 through $2, but found $1');
        expect(() => render('select $3', ['one', 'two']))
            .toThrow('expected $1 through $2, but found $3');
        expect(() => render('select $0', ['one']))
            .toThrow('invalid numbered placeholder \'$0\'');
    });

    it.each([
        undefined,
        Symbol('value'),
        () => 'value',
        Number.NaN,
        new Date(Number.NaN),
    ])('rejects unsupported script value %#', value => {
        expect(() => render('select $1', [value]))
            .toThrow('Migration scripts cannot render unsupported value type');
    });

    it('rejects structured values that cannot be serialized as JSON', () => {
        const cyclic: { self?: unknown } = {};
        cyclic.self = cyclic;

        expect(() => render('select $1', [cyclic]))
            .toThrow('unsupported value type \'object\'');
    });
});
