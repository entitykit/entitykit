import { buildSnapshot } from '../packages/mysql/src/mysql-introspect-snapshot';
import type { ColumnRow, ForeignKeyRow, StatisticRow } from '../packages/mysql/src/mysql-introspect-queries';

const column = (schema: string, table: string, name: string, ordinal: number): ColumnRow => ({
    table_schema: schema, table_name: table, column_name: name,
    ordinal_position: ordinal, column_type: 'int', is_nullable: 'NO',
    column_default: null, extra: '', collation_name: null,
});
const index = (schema: string, table: string, name: string): StatisticRow => ({
    table_schema: schema, table_name: table, index_name: name,
    column_name: 'id', non_unique: 1, seq_in_index: 1, sub_part: null,
});
const foreignKey = (schema: string, table: string, name: string, target: string): ForeignKeyRow => ({
    table_schema: schema, table_name: table, constraint_name: name,
    column_name: 'id', ordinal_position: 1, referenced_table_schema: target,
    referenced_table_name: 'authors', referenced_column_name: 'id', delete_rule: 'CASCADE',
});

describe('MySQL snapshot contracts', () => {
    it('orders schemas, objects, columns, and named constraints deterministically', () => {
        const snapshot = buildSnapshot([
            { table_schema: 'z_archive', table_name: 'z_books' },
            { table_schema: 'a_archive', table_name: 'authors' },
            { table_schema: 'bookshop', table_name: 'z_books', table_type: 'BASE TABLE' },
            { table_schema: 'bookshop', table_name: 'a_report', table_type: 'VIEW' },
        ], [
            column('bookshop', 'z_books', 'third', 3),
            column('bookshop', 'z_books', 'id', 1),
            column('bookshop', 'z_books', 'second', 2),
            column('z_archive', 'z_books', 'archived_id', 1),
        ], [
            index('bookshop', 'z_books', 'z_index'),
            index('bookshop', 'z_books', 'PRIMARY'),
            index('bookshop', 'z_books', 'a_index'),
            index('bookshop', 'z_books', 'z_fk'),
        ], [
            foreignKey('bookshop', 'z_books', 'z_fk', 'a_archive'),
            foreignKey('bookshop', 'z_books', 'a_fk', 'bookshop'),
        ], 'bookshop', [
            { constraint_schema: 'bookshop', table_name: 'z_books', constraint_name: 'z_check', check_clause: 'third > 0' },
            { constraint_schema: 'bookshop', table_name: 'z_books', constraint_name: 'a_check', check_clause: 'second > 0' },
        ]);
        expect(snapshot.schemas.map(schema => schema.name)).toEqual(['a_archive', '', 'z_archive']);
        const books = snapshot.schemas[1]?.tables[1];
        expect(snapshot.schemas[1]?.tables.map(table => [table.tableName, table.objectType]))
            .toEqual([['a_report', 'view'], ['z_books', 'table']]);
        expect(books.schemaName).toBe('');
        expect(books.columns.map(item => [item.name, item.ordinal]))
            .toEqual([['id', 1], ['second', 2], ['third', 3]]);
        expect(books.primaryKey).toEqual({ name: 'z_books_pkey', columns: ['id'] });
        expect(books.indexes.map(item => item.name)).toEqual(['a_index', 'z_index']);
        expect(books.foreignKeys).toEqual([
            { name: 'a_fk', columns: ['id'], principalSchemaName: '', principalTableName: 'authors', principalColumns: ['id'], onDelete: 'cascade' },
            { name: 'z_fk', columns: ['id'], principalSchemaName: 'a_archive', principalTableName: 'authors', principalColumns: ['id'], onDelete: 'cascade' },
        ]);
        expect(books.checkConstraints).toEqual([
            { name: 'a_check', sql: 'second > 0' },
            { name: 'z_check', sql: 'third > 0' },
        ]);
        expect(snapshot.schemas[2]?.tables[0]).toMatchObject({
            schemaName: 'z_archive', tableName: 'z_books', objectType: 'table',
            columns: [{ name: 'archived_id' }], foreignKeys: [], checkConstraints: [],
        });
    });

    it.each(['bookshop', 'excluded_database'])('ignores catalog rows for filtered objects in %s', schema => {
        const snapshot = buildSnapshot([
            { table_schema: 'bookshop', table_name: 'books' },
        ], [column(schema, 'filtered', 'id', 1)], [index(schema, 'filtered', 'ix_filtered')], [
            foreignKey(schema, 'filtered', 'fk_filtered', 'bookshop'),
        ], 'bookshop', [{
            constraint_schema: schema, table_name: 'filtered', constraint_name: 'ck_filtered', check_clause: 'id > 0',
        }]);
        expect(snapshot.schemas).toEqual([{
            name: '', tables: [{
                schemaName: '', tableName: 'books', objectType: 'table',
                columns: [], primaryKey: undefined, indexes: [], foreignKeys: [], checkConstraints: [],
            }],
        }]);
    });

    it.each([
        [undefined, '', undefined, undefined],
        [null, null, undefined, undefined],
        ['   ', 'STORED GENERATED', undefined, undefined],
        [' lower(`title`) ', 'STORED GENERATED', 'lower(`title`)', true],
        ['lower(`title`)', 'VIRTUAL GENERATED', 'lower(`title`)', false],
        ['lower(`title`)', null, 'lower(`title`)', false],
    ])('distinguishes generation expression %s and storage metadata %s', (expression, extra, generatedExpression, generatedStored) => {
        const snapshot = buildSnapshot([
            { table_schema: 'bookshop', table_name: 'books' },
        ], [{
            ...column('bookshop', 'books', 'normalized_title', 1),
            extra, generation_expression: expression,
        }], [], [], 'bookshop');
        expect(snapshot.schemas[0]?.tables[0]?.columns[0]).toEqual({
            name: 'normalized_title', ordinal: 1, storeType: 'int', isNullable: false,
            defaultSql: undefined, isStoreGenerated: false, storeGeneration: undefined,
            collation: undefined, generatedExpression, generatedStored,
        });
        expect(snapshot.schemas[0]?.tables[0]?.checkConstraints).toEqual([]);
    });
});
