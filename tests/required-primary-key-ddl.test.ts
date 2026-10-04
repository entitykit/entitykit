import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';
import { renderColumn } from '../packages/core/src/migrations/migration-builder-column-render';
import { postgresProviderServices } from '../packages/postgres/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requiredKeyModel } from './support/required-primary-key-support';

const providers = [
    { name: 'postgres', services: postgresProviderServices },
    { name: 'mysql', services: mySqlProviderServices },
    { name: 'sqlite', services: sqliteProviderServices },
];

class Author {
    public id!: string;
    public books!: Book[];
}
class Book {
    public id!: string;
    public authorId!: string;
    public author!: Author;
    public title!: string;
    public generated!: string;
}

describe.each(providers)('$name required column DDL', ({ name, services }) => {
    it.each(['text', 'varchar(64)'])('renders a required %s primary key without changing server SQL', type => {
        const sql = new SchemaSqlBuilder(services.dialect).build(requiredKeyModel(type));
        const key = sql.split('\n').find(line => line.includes(services.dialect.quoteIdentifier('id')));
        expect(key).toContain('primary key');
        expect(key?.includes('not null')).toBe(name === 'sqlite');
        expect(sql.split('\n').find(line => line.includes(services.dialect.quoteIdentifier('title')))).not.toContain('not null');
    });

    it.each([false, true])('preserves explicit nullable=%s for ordinary migration columns', nullable => {
        const sql = renderColumn({ name: 'Book"Label', type: 'varchar(64)', nullable }, services.dialect);
        expect(sql).toContain(services.dialect.quoteIdentifier('Book"Label'));
        expect(sql.includes('not null')).toBe(!nullable);
        expect(sql).not.toContain('primary key');
    });

    it('renders required composite keys without duplicating inline primary keys', () => {
        const model = new ModelBuilder().entity(Book, entity => {
            entity.toTable('books').hasKey(book => [book.id, book.authorId]);
            entity.property(book => book.id).hasColumnType('text');
            entity.property(book => book.authorId).hasColumnType('text');
        }).build();
        const sql = new SchemaSqlBuilder(services.dialect).build(model);
        expect(sql.match(/primary key/g)).toHaveLength(1);
        expect(sql.match(/not null/g)).toHaveLength(2);
    });

    it.each([false, true])('retains computed-column stored=%s through model and migration rendering', stored => {
        const model = new ModelBuilder().entity(Book, entity => {
            entity.toTable('books').hasKey(book => book.id);
            entity.property(book => book.id).hasColumnType('text');
            entity.property(book => book.generated).hasColumnType('text').hasComputedColumnSql('upper(\'book\')', stored);
        }).build();
        if (name === 'postgres' && !stored) {
            expect(() => new SchemaSqlBuilder(services.dialect).build(model)).toThrow('supports stored generated columns only');
            expect(() => renderColumn({ name: 'label', type: 'text', computedSql: 'upper(\'book\')', computedStored: stored }, services.dialect))
                .toThrow('supports stored generated columns only');
            return;
        }
        const expected = services.dialect.generatedColumnClause?.('upper(\'book\')', stored);
        expect(expected).toBeDefined();
        expect(new SchemaSqlBuilder(services.dialect).build(model)).toContain(expected);
        expect(renderColumn({ name: 'label', type: 'text', computedSql: 'upper(\'book\')', computedStored: stored }, services.dialect)).toContain(expected);
    });

    it('refuses generated columns when a custom dialect supplies no generated-column support', () => {
        const dialect = { ...services.dialect, name: 'unsupported-custom', generatedColumnClause: undefined };
        const model = new ModelBuilder().entity(Book, entity => {
            entity.toTable('books').hasKey(book => book.id);
            entity.property(book => book.id).hasColumnType('text');
            entity.property(book => book.generated).hasColumnType('text').hasComputedColumnSql('upper(\'book\')');
        }).build();
        expect(() => new SchemaSqlBuilder(dialect).build(model)).toThrow('Generated columns are not supported by the \'unsupported-custom\' provider.');
        expect(() => renderColumn({ name: 'label', type: 'text', computedSql: 'upper(\'book\')' }, dialect))
            .toThrow('Generated columns are not supported by the \'unsupported-custom\' provider.');
    });
});

describe('MySQL principal and foreign-key column types', () => {
    it('maps text primary and foreign keys to bounded strings while ordinary text remains unbounded', () => {
        const model = new ModelBuilder()
            .entity(Author, entity => {
                entity.toTable('authors').hasKey(author => author.id);
                entity.property(author => author.id).hasColumnType('text');
            })
            .entity(Book, entity => {
                entity.toTable('books').hasKey(book => book.id);
                entity.property(book => book.id).hasColumnType('text');
                entity.property(book => book.authorId).hasColumnType('text').isOptional();
                entity.property(book => book.title).hasColumnType('text').isOptional();
                entity.hasOne(Author, book => book.author).withMany(author => author.books).hasForeignKey(book => book.authorId);
            }).build();
        const sql = new SchemaSqlBuilder(mySqlProviderServices.dialect).build(model);
        expect(sql).toContain('`id` varchar(255)');
        expect(sql).toContain('`authorId` varchar(255)');
        expect(sql).toContain('`title` text');
    });
});
