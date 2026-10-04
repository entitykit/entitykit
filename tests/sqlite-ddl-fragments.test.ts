import {
    collectNamedCheckNames,
    hasKeywordSequence,
    matchingParen,
    parenthesizedBody,
    readIdentifier,
    simpleIdentifier,
    splitTopLevel,
    tableDefinitionSuffix,
    unquoteIdentifier,
} from '../packages/sqlite/src/sqlite-ddl-scanner';

describe('SQLite DDL fragment boundaries', () => {
    it.each([
        [undefined, undefined, ''],
        ['', undefined, ''],
        ['create table absent', undefined, ''],
        ['create table absent (id integer', undefined, ''],
        ['(id integer)', 'id integer', ''],
        ['create table "name (first)" (id integer) without rowid', 'id integer', ' without rowid'],
        ['create table `name (first)` (id integer) strict', 'id integer', ' strict'],
        ['create table [name (first)] (id integer)', 'id integer', ''],
    ])('extracts only an actual definition body from %s', (sql, body, suffix) => {
        expect(parenthesizedBody(sql)).toBe(body);
        expect(tableDefinitionSuffix(sql)).toBe(suffix);
    });

    it.each([
        ['(a, (b + c), \'it\'\'s )\') suffix', 0, 22],
        ['()', 0, 1],
        ['(', 0, -1],
        ['id integer', -1, -1],
        ['()', -1, -1],
        ['id integer', 0, -1],
        ['x(a)', 0, -1],
        ['()', 10, -1],
    ])('matches the requested opening parenthesis in %s', (sql, open, close) => {
        expect(matchingParen(sql, open)).toBe(close);
    });

    it('splits only top-level commas and drops empty fragments', () => {
        expect(splitTopLevel(', one, , coalesce(two, \'a,b)\'), [three,)], `four``five,`, "six""seven,", ')).toEqual([
            'one',
            'coalesce(two, \'a,b)\')',
            '[three,)]',
            '`four``five,`',
            '"six""seven,"',
        ]);
        expect(splitTopLevel('')).toEqual([]);
    });

    it.each([
        ['integer PRIMARY\tKEY\nDESC', ['primary', 'key', 'desc'], true],
        ['integer primary /* key desc */ key', ['primary', 'key', 'desc'], false],
        ['integer primary key -- desc\nasc', ['primary', 'key', 'desc'], false],
        ['integer primary key desc_suffix', ['primary', 'key', 'desc'], false],
        ['integer primary key desc$2', ['primary', 'key', 'desc'], false],
        ['\'primary key desc\' "primary key desc" `primary key desc` [primary key desc]', ['primary', 'key', 'desc'], false],
        ['\'it\'\'s primary key desc\'', ['primary', 'key', 'desc'], false],
        ['/* autoincrement */ -- autoincrement', ['autoincrement'], false],
        ['', ['autoincrement'], false],
        ['without /* comment */ rowid', ['WITHOUT', 'ROWID'], true],
    ])('recognizes executable keywords in %s', (sql, keywords, expected) => {
        expect(hasKeywordSequence(sql, keywords)).toBe(expected);
    });

    it.each([
        ['id integer', 'id'],
        ['_item$32 text', '_item$32'],
        ['"long ""identifier" text', '"long ""identifier"'],
        ['`long ``identifier` text', '`long ``identifier`'],
        ['[long identifier] text', '[long identifier]'],
        ['123invalid integer', undefined],
        ['(id)', undefined],
        ['', undefined],
    ])('reads an identifier only at the start of %s', (sql, expected) => {
        expect(readIdentifier(sql)).toBe(expected);
    });

    it.each([
        ['  _item$32  ', '_item$32'],
        [' "long ""identifier" ', 'long "identifier'],
        [' `long ``identifier` ', 'long `identifier'],
        [' [long identifier] ', 'long identifier'],
        ['lower(id)', undefined],
        ['id desc', undefined],
        ['(id)', undefined],
        ['123invalid', undefined],
        ['', undefined],
    ])('distinguishes complete column identifiers from expressions in %s', (sql, expected) => {
        expect(simpleIdentifier(sql)).toBe(expected);
    });

    it.each([
        ['plain', 'plain'],
        ['"a""b"', 'a"b'],
        ['`a``b``c`', 'a`b`c'],
        ['[a b]', 'a b'],
        ['"incomplete', '"incomplete'],
        ['incomplete"', 'incomplete"'],
        ['`incomplete', '`incomplete'],
        ['incomplete`', 'incomplete`'],
        ['[incomplete', '[incomplete'],
        ['incomplete]', 'incomplete]'],
        ['', ''],
    ])('removes only paired identifier quotes in %s', (sql, expected) => {
        expect(unquoteIdentifier(sql)).toBe(expected);
    });

    it('reserves named checks across definitions while ignoring quoted and commented text', () => {
        expect(collectNamedCheckNames([
            'id integer constraint    ck_pulled_1    check(id > 0)',
            'value integer constraint "long ""check" check(value > 0)',
            'other integer constraint `long ``check` check(other > 0)',
            'constraint [last check] check(id < 10)',
            'label text default \'constraint fake check(0)\'',
            'note text /* constraint commented check(0) */',
        ])).toEqual(new Set(['ck_pulled_1', 'long "check', 'long `check', 'last check']));
    });
});
