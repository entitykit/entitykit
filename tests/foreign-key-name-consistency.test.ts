import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';import { createModelSnapshot } from '../packages/core/src/model/model-snapshot';
import { diffModelSnapshots } from '../packages/core/src/migrations/api';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';

/**
 * `createSchemaScript` creates a foreign key with a default name, and the
 * migration differ later references it by name to drop or recreate it. If the
 * two paths compute the name differently, a migration against a
 * createSchemaScript-built database drops a constraint that does not exist under
 * that name. They must agree.
 */
class Author {
    public id!: string;
    public name!: string;
    public posts?: Post[];
}

class Post {
    public id!: string;
    public authorId!: string;
    public author?: Author;
}

function buildModel(): ModelBuilderImplementation {
    const model = new ModelBuilderImplementation();
    model.entity(Author, entity => {
        entity.toTable('authors');
        entity.hasKey(author => author.id);
        entity.property(author => author.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(author => author.name).hasColumnName('name').hasColumnType('text').isRequired();
    });
    model.entity(Post, entity => {
        entity.toTable('posts');
        entity.hasKey(post => post.id);
        entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
        entity.hasOne(Author, post => post.author).withMany(author => author.posts).hasForeignKey(post => post.authorId);
    });
    return model;
}

describe('default foreign-key name consistency', () => {
    it('the schema builder and the migration differ generate the same name', () => {
        const model = buildModel().build();

        const schemaScript = new SchemaSqlBuilder().build(model);
        const schemaName = /constraint "([^"]+)" foreign key/.exec(schemaScript)?.[1];

        const diff = diffModelSnapshots({ formatVersion: 1, entities: [] }, createModelSnapshot(model));
        const migrationName = diff.operations.find(operation => operation.kind === 'addForeignKey')?.name;

        // Descriptive scheme: fk_<child>_<principal>_<column>, what actually lands in
        // the database and what `db pull` reads back.
        expect(schemaName).toBe('fk_posts_authors_author_id');
        expect(migrationName).toBe(schemaName);
    });
});
