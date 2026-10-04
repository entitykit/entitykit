import type { EntityBuilder, IndexKeyPart } from '../packages/core/src';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';

class Book {
    public id = 0; public edition = ''; public title = '';
}
class BookDetail {
    public id = 0;
    public book!: Book;
}
function bookModel(configure: (entity: EntityBuilder<Book>) => void): ModelBuilderImplementation {
    return new ModelBuilderImplementation().entity(Book, entity => {
        entity.toTable('books');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.edition).hasColumnName('Edition Label').hasColumnType('varchar(64)');
        entity.property(row => row.title).hasColumnName('Book,Title').hasColumnType('varchar(64)');
        configure(entity);
    });
}

describe('ordered index key model contracts', () => {
    it('rejects missing terms in sparse descriptor arrays before registering an index', () => {
        const parts: Array<IndexKeyPart<Book>> = [];
        parts.length = 2;
        parts[0] = { kind: 'property', propertyName: 'edition' };
        const model = bookModel(entity => {
            expect(() => entity.hasIndex(parts)).toThrow(TypeError);
            entity.hasIndex('title').hasDatabaseName('ix_valid');
        });
        expect(model.build().getEntity(Book).indexes).toEqual([{ propertyNames: ['title'], databaseName: 'ix_valid', isUnique: false }]);
    });
    it('uses the primary key to enforce a shared-key one-to-one relationship without a redundant index', () => {
        const builder = bookModel(() => undefined);
        builder.entity(BookDetail, entity => {
            entity.toTable('book_details');
            entity.hasKey('id');
            entity.property('id').hasColumnType('integer');
            entity.hasOne(Book, row => row.book).withOne().hasForeignKey('id');
        });
        const detail = builder.build().getEntity(BookDetail);
        expect(detail.keyProperties).toEqual(['id']);
        expect(detail.relationships).toHaveLength(1);
        expect(detail.indexes).toEqual([]);
    });
    it('supports ordinary indexes on a keyless read model without inventing a primary key', () => {
        const entity = new ModelBuilderImplementation().entity(Book, mapping => {
            mapping.toTable('book_report').hasNoKey();
            mapping.property('edition').hasColumnType('text');
            mapping.hasIndex('edition');
        }).build().getEntity(Book);
        expect(entity.keyProperties).toEqual([]);
        expect(entity.indexes).toEqual([{ propertyNames: ['edition'], isUnique: false }]);
    });
    it('keeps string primary keys required even when the property began optional', () => {
        const model = new ModelBuilderImplementation().entity(Book, entity => {
            entity.toTable('books');
            entity.property('id').hasColumnType('integer').isOptional();
            entity.hasKey('id');
        }).build().getEntity(Book);
        expect(model.keyProperties).toEqual(['id']);
        expect(model.properties.find(property => property.propertyName === 'id')?.isRequired).toBe(true);
    });
    it.each([{ expressions: '  lower(title)  ' }, { expressions: ['  lower(title)  ', ' upper(edition) '] }])('normalizes legacy expressions: $expressions', ({ expressions }) => {
        const model = bookModel(entity => entity.hasExpressionIndex(expressions).hasDatabaseName('ix_expression'));
        expect(model.build().getEntity(Book).indexes[0]?.keyParts).toEqual(
            (typeof expressions === 'string' ? [expressions] : expressions).map(expression => ({ kind: 'expression', expression: expression.trim() })),
        );
    });
    it.each([{ expressions: [] }, { expressions: [''] }, { expressions: ['   '] }, { expressions: ['lower(title)', ' '] }])('refuses empty legacy terms atomically: $expressions', ({ expressions }) => {
        const model = bookModel(entity => {
            expect(() => entity.hasExpressionIndex(expressions)).toThrow('Expression indexes require at least one non-empty SQL expression.');
            entity.hasIndex('edition').hasDatabaseName('ix_valid');
        });
        expect(model.build().getEntity(Book).indexes).toEqual([{ propertyNames: ['edition'], databaseName: 'ix_valid', isUnique: false }]);
    });
    it.each([
        { value: [], message: 'Index key parts require at least one property or expression.' },
        { value: [null], message: 'Index key parts must declare property or expression.' },
        { value: ['edition'], message: 'Index key parts must declare property or expression.' },
        { value: [Object.assign(() => undefined, { kind: 'property', propertyName: 'edition' })], message: 'Index key parts must declare property or expression.' },
        { value: [{ kind: 'column', name: 'edition' }], message: 'Index key parts must declare property or expression.' },
        { value: [{ kind: 'property', propertyName: '' }], message: 'Index property key parts require a non-empty property name.' },
        { value: [{ kind: 'expression', expression: '  ' }], message: 'Index expression key parts require a non-empty SQL expression.' },
        { value: [{ kind: 'expression', expression: 1 }], message: 'Index expression key parts require a non-empty SQL expression.' },
    ])('explains invalid key parts: $message', ({ value, message }) => {
        bookModel(entity => {
            expect(() => {
                Reflect.apply(entity.hasIndex.bind(entity), undefined, [value]);
            }).toThrow(message);
        });
    });
    it.each([false, true])('preserves mixed key order, reverse=%s', reverse => {
        const parts: Array<IndexKeyPart<Book>> = [
            { kind: 'property', propertyName: 'edition' }, { kind: 'expression', expression: ' lower("Book,Title") ' },
        ];
        if (reverse) parts.reverse();
        const model = bookModel(entity => entity.hasIndex(parts).hasDatabaseName('ix_books').isUnique().includeProperties(row => row.id));
        const index = model.build().getEntity(Book).indexes[0];
        expect(index).toMatchObject({
            propertyNames: ['edition'], keyParts: parts.map(part => part.kind === 'expression'
                ? { ...part, expression: part.expression.trim() } : part),
            databaseName: 'ix_books', isUnique: true, includedPropertyNames: ['id'],
        });
    });

    it('copies caller key records and their array before later mutation', () => {
        const property: { kind: 'property'; propertyName: 'edition' | 'title' } = { kind: 'property', propertyName: 'edition' };
        const expression: { kind: 'expression'; expression: string } = { kind: 'expression', expression: 'lower("Book,Title")' };
        const parts: Array<IndexKeyPart<Book>> = [property, expression];
        const model = bookModel(entity => entity.hasIndex(parts).hasDatabaseName('ix_books'));
        property.propertyName = 'title'; expression.expression = 'invalid_sql('; parts.reverse();
        parts.push({ kind: 'property', propertyName: 'id' });
        expect(model.build().getEntity(Book).indexes[0]).toMatchObject({
            propertyNames: ['edition'], keyParts: [
                { kind: 'property', propertyName: 'edition' }, { kind: 'expression', expression: 'lower("Book,Title")' },
            ],
        });
    });

    it.each([
        { label: 'empty list', value: [] }, { label: 'null list', value: null },
        { label: 'object list', value: {} }, { label: 'number list', value: 1 },
        { label: 'null term', value: [null] }, { label: 'undefined term', value: [undefined] },
        { label: 'boolean term', value: [false] }, { label: 'string term', value: ['edition'] },
        { label: 'missing kind', value: [{}] }, { label: 'unknown kind', value: [{ kind: 'column', name: 'edition' }] },
        { label: 'missing property', value: [{ kind: 'property' }] },
        { label: 'empty property', value: [{ kind: 'property', propertyName: '' }] },
        { label: 'numeric property', value: [{ kind: 'property', propertyName: 1 }] },
        { label: 'null property', value: [{ kind: 'property', propertyName: null }] },
        { label: 'missing expression', value: [{ kind: 'expression' }] },
        { label: 'empty expression', value: [{ kind: 'expression', expression: '' }] },
        { label: 'blank expression', value: [{ kind: 'expression', expression: '   ' }] },
        { label: 'numeric expression', value: [{ kind: 'expression', expression: 1 }] },
        { label: 'null expression', value: [{ kind: 'expression', expression: null }] },
        { label: 'partially valid list', value: [{ kind: 'property', propertyName: 'edition' }, { kind: 'expression', expression: '' }] },
    ])('refuses $label before registering any index', ({ value }) => {
        const model = bookModel(entity => {
            expect(() => {
                Reflect.apply(entity.hasIndex.bind(entity), undefined, [value]);
            }).toThrow(TypeError);
            entity.hasIndex(row => row.edition).hasDatabaseName('ix_valid');
        });
        expect(model.build().getEntity(Book).indexes).toEqual([
            { propertyNames: ['edition'], databaseName: 'ix_valid', isUnique: false },
        ]);
    });

    it('keeps legacy selector and property calls alongside property-only descriptors', () => {
        const model = bookModel(entity => {
            entity.hasIndex('edition');
            entity.hasIndex(row => [row.edition, row.title]);
            entity.hasIndex([{ kind: 'property', propertyName: 'title' }]);
        });
        expect(model.build().getEntity(Book).indexes.map(index => index.propertyNames))
            .toEqual([['edition'], ['edition', 'title'], ['title']]);
    });

    it('supports expression-only descriptors while keeping name requirements', () => {
        expect(() => bookModel(entity => entity.hasIndex([{ kind: 'expression', expression: 'lower(title)' }])).build())
            .toThrow('must configure a database name');
        const model = bookModel(entity => entity.hasIndex([{ kind: 'expression', expression: ' lower(title) ' }]).hasDatabaseName('ix_expression'));
        expect(model.build().getEntity(Book).indexes[0]?.keyParts)
            .toEqual([{ kind: 'expression', expression: 'lower(title)' }]);
    });

    it('retains configured-property and duplicate-key validation for descriptors', () => {
        expect(() => bookModel(entity => {
            Reflect.apply(entity.hasIndex.bind(entity), undefined, [[{ kind: 'property', propertyName: 'missing' }]]);
        }).build()).toThrow('references unconfigured property');
        expect(() => bookModel(entity => entity.hasIndex([
            { kind: 'property', propertyName: 'edition' }, { kind: 'property', propertyName: 'edition' },
        ])).build()).toThrow('lists property \'edition\' more than once');
    });
});
