import { hasMultipleStatements } from '../packages/sqlite/src/sqlite-statement';

describe('SQLite statement separator classification', () => {
    it.each<[string, boolean]>([
        ['', false],
        [' \n\t ', false],
        ['select id from rows where id = ?', false],
        ['update rows set name = ? where id = ?', false],
        ['select 1 -- no separator\n', false],
        ['select /* no separator */ 1', false],
        ['select 1;', false],
        ['select 1; \n\t', false],
        ['select 1; select 2', true],
        ['; select 2', true],
        ['select \';\'', false],
        ['select ";"', false],
        ['select \'it\'\'s; one literal\'', false],
        ['select "a"";b"', false],
        ['select 1 -- ; ignored\n', false],
        ['select 1 /* ; ignored */', false],
        ['select \';\'; select 2', true],
        ['select ";"; select 2', true],
        ['select 1 -- ; ignored\n; select 2', true],
        ['select 1 /* ; ignored */; select 2', true],
        ['select -1; select 2', true],
        ['select 5-3; select 2', true],
        ['select 6/2; select 3', true],
        ['select 2*3; select 4', true],
        ['select 1 /* a/b; c*d; end */', false],
        ['select /* abc; def */ 1', false],
        ['select 1 /*/;*/', false],
        ['select 2 /* comment */*3; select 4', true],
        // Preserve the existing conservative treatment of text after a separator.
        ['select 1; -- trailing comment', true],
        ['select 1; /* trailing comment */', true],
    ])('classifies %j as multiple=%s', (sql, expected) => {
        expect(hasMultipleStatements(sql)).toBe(expected);
    });
});
