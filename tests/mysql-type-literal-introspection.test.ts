import { buildSnapshot } from '../packages/mysql/src/mysql-introspect-snapshot';
import { generateDbPullCode } from '../packages/core/src/tooling';

describe('MySQL introspection of literal-bearing types', () => {
    it.each([
        'enum(\'Paperback\',\'Hardcover\')',
        'set(\'NewYork\',\'SanFrancisco\')',
        'enum(\'Draft\',\'DRAFT\')',
        'enum(\'Collector\'\'s Edition\',\'Édition Française\')',
        'set(\'A(B)\',\'B,C\')',
    ])('retains every literal in %s through db-pull configuration', type => {
        const snapshot = buildSnapshot([
            { table_schema: 'bookshop', table_name: 'book_format' },
        ], [{
            table_schema: 'bookshop', table_name: 'book_format',
            column_name: 'format', ordinal_position: '1', column_type: type,
            is_nullable: 'NO', column_default: null, extra: '',
            collation_name: 'utf8mb4_bin',
        }], [{
            table_schema: 'bookshop', table_name: 'book_format',
            index_name: 'PRIMARY', non_unique: '0', seq_in_index: '1',
            column_name: 'format', sub_part: null,
        }], [], 'bookshop');
        expect(snapshot.schemas[0]?.tables[0]?.columns[0]?.storeType).toBe(type);
        const source = generateDbPullCode(snapshot, { providerName: 'mysql' })
            .map(file => file.contents).join('\n');
        expect(source).toContain(`.hasColumnType(${JSON.stringify(type)})`);
    });

    it('retains the database spelling of types without literals', () => {
        const snapshot = buildSnapshot([
            { table_schema: 'bookshop', table_name: 'book_format' },
        ], [{
            table_schema: 'bookshop', table_name: 'book_format',
            column_name: 'weight', ordinal_position: 1, column_type: 'decimal(12,4)',
            is_nullable: 'YES', column_default: '1.2500', extra: null,
            collation_name: null,
        }], [], [], 'bookshop');
        expect(snapshot.schemas[0]?.tables[0]?.columns[0]).toMatchObject({
            storeType: 'decimal(12,4)', defaultSql: '1.2500',
            isNullable: true, isStoreGenerated: false,
        });
    });
});
