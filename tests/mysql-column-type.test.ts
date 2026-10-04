import { mapMysqlColumnType } from '../packages/mysql/src/mysql-column-type';

describe('MySQL column type translation', () => {
    it.each([
        ['text', false, 'text collate utf8mb4_bin'],
        ['TEXT', true, 'varchar(255) collate utf8mb4_bin'],
        ['character varying', false, 'text collate utf8mb4_bin'],
        ['CHARACTER VARYING (80)', true, 'varchar(80) collate utf8mb4_bin'],
        ['varchar', false, 'varchar(255) collate utf8mb4_bin'],
        [' VaRcHaR (80) ', false, 'varchar(80) collate utf8mb4_bin'],
        ['varchar(80)', true, 'varchar(80) collate utf8mb4_bin'],
        ['char', false, 'char(1) collate utf8mb4_bin'],
        [' CHAR (12) ', true, 'char(12) collate utf8mb4_bin'],
        ['uuid', false, 'char(36) collate utf8mb4_bin'],
        [' UUID ', true, 'char(36) collate utf8mb4_bin'],
    ])('maps %s with key=%s to %s', (type, isKey, expected) => {
        expect(mapMysqlColumnType(type, { isKey })).toBe(expected);
    });

    it.each(['timestamptz', 'timestamp with time zone', 'timestamp', 'datetime'])('maps %s to a millisecond UTC storage type', type => {
        expect(mapMysqlColumnType(` ${type.toUpperCase()}(6) `, { isKey: false }))
            .toBe('datetime(3)');
    });

    it.each([
        ['jsonb', 'json'], ['json', 'json'],
        ['boolean', 'tinyint(1)'], ['bool', 'tinyint(1)'],
        ['integer', 'int'], ['int4', 'int'],
        ['int8', 'bigint'], ['bigint', 'bigint'],
        ['double precision', 'double'], ['double', 'double'],
    ])('maps the case-insensitive %s alias to %s', (type, expected) => {
        expect(mapMysqlColumnType(` ${type.toUpperCase()} `, { isKey: false }))
            .toBe(expected);
    });

    it.each([
        ['text', false, 'text'],
        ['text', true, 'varchar(255)'],
        ['character varying', false, 'text'],
        ['varchar(80)', false, 'varchar(80)'],
        ['char', false, 'char(1)'],
        ['char(12)', true, 'char(12)'],
        ['uuid', true, 'char(36)'],
    ])('leaves an explicit collation to the renderer for %s', (type, isKey, expected) => {
        expect(mapMysqlColumnType(type, { isKey, collation: 'utf8mb4_0900_ai_ci' }))
            .toBe(expected);
    });

    it('uses its binary default when the collation is empty', () => {
        expect(mapMysqlColumnType('varchar', { isKey: false, collation: '' }))
            .toBe('varchar(255) collate utf8mb4_bin');
    });

    it.each([
        'ENUM(\'Paperback\',\'Hardcover\')',
        'set(\'NewYork\',\'SanFrancisco\')',
        'enum(\'Draft\',\'DRAFT\')',
        'ENUM(\'Collector\'\'s Edition\',\'Édition Française\')',
        'SET(\'A(B)\',\'B,C\')',
        'DECIMAL(12,4)', 'int unsigned', 'varbinary(16)',
    ])('preserves provider-specific syntax and literal values in %s', type => {
        expect(mapMysqlColumnType(` ${type} `, { isKey: false })).toBe(type);
        expect(mapMysqlColumnType(type, { isKey: true, collation: 'utf8mb4_bin' }))
            .toBe(type);
    });
});
