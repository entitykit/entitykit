import { mapStoreTypeToTypeScript } from '../src/introspection/db-pull-type-mapping';

describe('db pull type mapping', () => {
    it('maps provider store types with review status', () => {
        const cases: ReadonlyArray<[
      storeType: string,
      type: string,
      needsReview: boolean,
        ]> = [
            ['integer', 'number', false],
            ['INT(11)', 'number', false],
            ['int unsigned', 'number', false],
            ['bigserial', 'number', false],
            ['tinyint(4)', 'number', false],
            ['bigint unsigned', 'string', true],
            ['decimal(10,2) zerofill', 'string', true],
            ['numeric', 'string', true],
            ['tinyint(1)', 'boolean', false],
            ['bit(1)', 'boolean', false],
            ['boolean', 'boolean', false],
            ['timestamp with time zone', 'Date', false],
            ['datetime(6)', 'Date', false],
            ['date', 'Date', false],
            ['time(6)', 'string', false],
            ['timetz', 'string', false],
            ['jsonb', 'JsonValue', false],
            ['bytea', 'Buffer', false],
            ['varbinary(255)', 'Buffer', false],
            ['uuid', 'string', false],
            ['character varying(255)', 'string', false],
            ['set(\'red\',\'blue\')', 'string', true],
            ['interval', 'unknown', true],
            ['geography', 'unknown', true],
            ['enum()', 'unknown', true],
        ];

        for (const [storeType, type, needsReview] of cases) {
            expect(mapStoreTypeToTypeScript(storeType)).toEqual({
                type,
                needsReview,
            });
        }
    });

    it('preserves MySQL enum member spelling and escaped quotes', () => {
        expect(
            mapStoreTypeToTypeScript('enum(\'Draft\',\'O\'\'Clock\',\'Sent\')'),
        ).toEqual({
            type: '"Draft" | "O\'Clock" | "Sent"',
            needsReview: false,
        });
    });

    it('renders known and review-required array element types', () => {
        expect(mapStoreTypeToTypeScript('integer[]')).toEqual({
            type: 'number[]',
            needsReview: false,
        });
        expect(mapStoreTypeToTypeScript('numeric[]')).toEqual({
            type: 'string[]',
            needsReview: true,
        });
        expect(mapStoreTypeToTypeScript('jsonb[]')).toEqual({
            type: 'JsonValue[]',
            needsReview: false,
        });
    });
});
