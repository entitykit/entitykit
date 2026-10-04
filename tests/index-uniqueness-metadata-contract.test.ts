import type { EntityBuilder } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';

class Book {
    public id!: string;
    public isbn!: string;
    public title!: string;
}
function books(configure: (entity: EntityBuilder<Book>) => void): ModelBuilder {
    return new ModelBuilder().entity(Book, entity => {
        entity.toTable('indexed_books').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text');
        entity.property(row => row.isbn).hasColumnType('text');
        entity.property(row => row.title).hasColumnType('text');
        configure(entity);
    });
}

describe('unique-index metadata preservation', () => {
    it('retains property-level uniqueness without duplicating primary-key indexes', () => {
        const metadata = books(entity => {
            entity.property(row => row.id).isUnique();
            entity.property(row => row.isbn).isUnique();
        }).build().getEntity(Book);
        expect(metadata.indexes).toEqual([{ propertyNames: ['isbn'], isUnique: true }]);
    });

    it.each([
        [undefined, undefined], [undefined, 'ak_books_isbn'],
        ['ak_books_isbn', undefined], ['ak_books_isbn', 'ak_books_isbn'],
    ] as const)('preserves index name=%s and alternate-key name=%s', (indexName, keyName) => {
        const metadata = books(entity => {
            const index = entity.hasIndex(row => row.isbn).isUnique().includeProperties(row => row.title);
            if (indexName !== undefined) index.hasDatabaseName(indexName);
            const key = entity.hasAlternateKey(row => row.isbn);
            if (keyName !== undefined) key.hasDatabaseName(keyName);
        }).build().getEntity(Book);
        expect(metadata.indexes).toHaveLength(1);
        expect(metadata.indexes[0]).toMatchObject({
            propertyNames: ['isbn'], isUnique: true, includedPropertyNames: ['title'],
        });
        expect(metadata.indexes[0]?.databaseName).toBe(indexName ?? keyName);
    });

    it('refuses conflicting names for the same alternate key and backing index', () => {
        expect(() => books(entity => {
            entity.hasIndex(row => row.isbn).isUnique().hasDatabaseName('ux_isbn');
            entity.hasAlternateKey(row => row.isbn).hasDatabaseName('ak_isbn');
        }).build()).toThrow('Alternate key and unique index over (isbn) configure different database names.');
    });

    it.each([
        { columns: ['missing'], message: 'Included column on entity \'Book\' references unconfigured property \'missing\'.' },
        { columns: ['title', 'title'], message: 'Included column on entity \'Book\' lists property \'title\' more than once.' },
    ])('refuses invalid covering columns $columns', ({ columns, message }) => {
        expect(() => books(entity => {
            entity.hasIndex(row => row.isbn).includeProperties(row => columns.map(column => row[column as keyof Book]));
        }).build()).toThrow(message);
    });
});
