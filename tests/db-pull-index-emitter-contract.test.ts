import { renderIndexConfigurations } from '../packages/core/src/introspection/db-pull-index-config-emitter';
import type { EntityShape } from '../packages/core/src/introspection/db-pull-codegen-types';
import type { DatabaseIndex } from '../packages/core/src/tooling';

function book(index: DatabaseIndex): EntityShape {
    return {
        className: 'Book', setName: 'books', propertiesByColumn: new Map([
            ['id', 'id'], ['Edition Label', 'edition'], ['Book,Title', 'title'], ['cover', 'cover'],
        ]),
        table: { schemaName: 'bookshop', tableName: 'books', columns: [], foreignKeys: [], indexes: [index] },
    };
}

function render(index: DatabaseIndex): string[] {
    const entity = book(index);
    return renderIndexConfigurations(entity, [entity]);
}

describe('db pull index configuration contracts', () => {
    it.each([
        { columns: ['Edition Label'], selector: 'row => row.edition' },
        { columns: ['Edition Label', 'Book,Title'], selector: 'row => [row.edition, row.title]' },
    ])('promotes referenced unique keys to alternate keys: $columns', ({ columns, selector }) => {
        const principal = book({ name: 'uq_books', columns, isUnique: true });
        const dependent: EntityShape = {
            ...book({ name: 'ix_checkout', columns: ['id'], isUnique: false }),
            className: 'Checkout', setName: 'checkouts',
            table: {
                schemaName: 'bookshop', tableName: 'checkouts', columns: [], indexes: [],
                foreignKeys: [{ name: 'fk_checkout_book', columns, principalSchemaName: 'bookshop', principalTableName: 'books', principalColumns: columns, onDelete: 'NO ACTION' }],
            },
        };
        expect(renderIndexConfigurations(principal, [principal, dependent]))
            .toEqual([`      entity.hasAlternateKey(${selector}).hasDatabaseName("uq_books");`]);
    });
    it('renders a scalar ordinary index with uniqueness, include and filter facets', () => {
        expect(render({ name: 'ix_books', columns: ['Edition Label'], isUnique: true, includedColumns: ['cover'], filter: 'price > 0' }))
            .toEqual(['      entity.hasIndex(row => row.edition).hasDatabaseName("ix_books").isUnique().includeProperties(row => row.cover).hasFilter("price > 0");']);
    });
    it('renders ordered composite keys and included properties', () => {
        expect(render({ name: 'ix_books', columns: ['Edition Label', 'Book,Title'], isUnique: false, includedColumns: ['cover', 'id'] }))
            .toEqual(['      entity.hasIndex(row => [row.edition, row.title]).hasDatabaseName("ix_books").includeProperties(row => [row.cover, row.id]);']);
    });
    it('keeps expression-only terms as SQL expressions', () => {
        expect(render({ name: 'ix_expression', columns: [], isUnique: false, keyParts: [{ kind: 'expression', expression: 'lower("Book,Title")' }] }))
            .toEqual(['      entity.hasExpressionIndex(["lower(\\"Book,Title\\")"]).hasDatabaseName("ix_expression");']);
    });
    it.each([
        { label: 'empty keys', index: { name: 'ix_bad', columns: [], isUnique: false }, reason: 'has no mapped columns' },
        { label: 'unmapped key', index: { name: 'ix_bad', columns: ['missing'], isUnique: false }, reason: 'references column(s) missing' },
        { label: 'unmapped include', index: { name: 'ix_bad', columns: ['id'], isUnique: false, includedColumns: ['missing'] }, reason: 'has no mapped columns' },
        { label: 'unsupported facet', index: { name: 'ix_bad', columns: ['id'], isUnique: false, unsupportedFeatures: ['descending', 'operator class'] }, reason: 'uses unsupported descending, operator class metadata' },
    ])('skips $label with a diagnostic and no executable index', ({ index, reason }) => {
        const lines = render(index);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('// TODO: Index \'ix_bad\' on "bookshop"."books"');
        expect(lines[0]).toContain(reason);
        expect(lines[0]).not.toContain('entity.has');
    });
});
