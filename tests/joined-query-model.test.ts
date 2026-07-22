import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';import type { Model } from '../src/model/model';
import { createJoinedQueryProxy, Queryable, type QueryExecutor } from '../src/experimental';
import { buildSelectSqlCacheKey } from '../src/sql/select-sql-builder';
import { containing } from './support/jest-asymmetric-matchers';

class Author {
    public id!: string;
    public email!: string;
}

class BlogPost {
    public id!: string;
    public authorId!: string;
    public workspaceId!: string;
    public createdAt!: Date;
}

class Workspace {
    public id!: string;
    public name!: string;
}

function createModel(): Model {
    const model = new ModelBuilderImplementation();
    model.entity(Author, entity => {
        entity.toTable('authors');
        entity.hasKey(author => author.id);
        entity.property(author => author.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(author => author.email).hasColumnName('email').hasColumnType('text').isRequired();
    });
    model.entity(BlogPost, entity => {
        entity.toTable('blog_posts');
        entity.hasKey(post => post.id);
        entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
        entity.property(post => post.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
        entity.property(post => post.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
    });
    model.entity(Workspace, entity => {
        entity.toTable('workspaces');
        entity.hasKey(workspace => workspace.id);
        entity.property(workspace => workspace.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(workspace => workspace.name).hasColumnName('name').hasColumnType('text').isRequired();
    });
    return model.build();
}

class RecordingExecutor implements QueryExecutor<BlogPost> {
    public async executeToArray(): Promise<BlogPost[]> {
        return Promise.resolve([]);
    }

    public async executeCount(): Promise<number> {
        return Promise.resolve(0);
    }

    public async executeExists(): Promise<boolean> {
        return Promise.resolve(false);
    }

    public async executeProjectionToArray<TProjection extends Record<string, unknown>>(): Promise<TProjection[]> {
        return Promise.resolve([]);
    }

    public async executeAggregateToArray<TProjection extends Record<string, unknown>>(): Promise<TProjection[]> {
        return Promise.resolve([]);
    }
}

describe('joined query model primitives', () => {
    it('records inner join model nodes with field-to-field predicates', () => {
        const model = createModel();
        const posts = new Queryable(model.getEntity(BlogPost), new RecordingExecutor());
        const joined = posts.join('author', { metadata: model.getEntity(Author) }, ({ root, author }) =>
            root.authorId.eq(author.id),
        );

        expect(joined.toQueryModel().joins).toEqual([{
            alias: 'author',
            metadata: model.getEntity(Author),
            kind: 'inner',
            predicate: containing({
                node: {
                    kind: 'fieldComparison',
                    operator: 'eq',
                    left: { sourceAlias: 'root', propertyName: 'authorId' },
                    right: { sourceAlias: 'author', propertyName: 'id' },
                },
            }),
        }]);
    });

    it('chains joins immutably', () => {
        const model = createModel();
        const posts = new Queryable(model.getEntity(BlogPost), new RecordingExecutor());
        const withAuthor = posts.join('author', { metadata: model.getEntity(Author) }, ({ root, author }) =>
            root.authorId.eq(author.id),
        );
        const withWorkspace = withAuthor.leftJoin('workspace', { metadata: model.getEntity(Workspace) }, ({ root, workspace }) =>
            root.workspaceId.eq(workspace.id),
        );

        expect(withAuthor.toQueryModel().joins.map(join => join.alias)).toEqual(['author']);
        expect(withWorkspace.toQueryModel().joins.map(join => `${join.kind}:${join.alias}`)).toEqual([
            'inner:author',
            'left:workspace',
        ]);
    });

    it('rejects reserved, duplicate, and unknown join aliases', () => {
        const model = createModel();
        const posts = new Queryable(model.getEntity(BlogPost), new RecordingExecutor());

        expect(() => posts.join('root', { metadata: model.getEntity(Author) }, ({ root }) => root.authorId.eq('usr_1')))
            .toThrow('Join alias \'root\' is reserved');
        expect(() => posts.join('', { metadata: model.getEntity(Author) }, ({ root }) => root.authorId.eq('usr_1')))
            .toThrow('Join alias must be a non-empty string');
        expect(() => posts
            .join('author', { metadata: model.getEntity(Author) }, ({ root, author }) => root.authorId.eq(author.id))
            .leftJoin('author', { metadata: model.getEntity(Workspace) }, ({ root, author }) => root.workspaceId.eq(author.id)))
            .toThrow('Join alias \'author\' is already used');
        expect(() => (createJoinedQueryProxy<BlogPost, { author: Author }>(['author']) as never as { missing: { id: unknown } }).missing.id)
            .toThrow('Joined query source \'missing\' has not been joined');
    });

    it('includes join shape in select SQL cache keys', () => {
        const model = createModel();
        const postMetadata = model.getEntity(BlogPost);
        const posts = new Queryable(postMetadata, new RecordingExecutor());
        const withAuthor = posts.join('author', { metadata: model.getEntity(Author) }, ({ root, author }) =>
            root.authorId.eq(author.id),
        );
        const withWorkspace = posts.join('workspace', { metadata: model.getEntity(Workspace) }, ({ root, workspace }) =>
            root.workspaceId.eq(workspace.id),
        );

        const authorKey = buildSelectSqlCacheKey(postMetadata, withAuthor.toQueryModel());
        const workspaceKey = buildSelectSqlCacheKey(postMetadata, withWorkspace.toQueryModel());

        expect(authorKey).not.toBe(workspaceKey);
        expect(JSON.parse(authorKey)).toMatchObject({
            joins: [{
                alias: 'author',
                entityName: 'Author',
                table: 'authors',
                kind: 'inner',
                predicate: {
                    kind: 'fieldComparison',
                    left: { sourceAlias: 'root', propertyName: 'authorId' },
                    right: { sourceAlias: 'author', propertyName: 'id' },
                },
            }],
        });
    });

    it('includes joined aggregate source aliases in select SQL cache keys', () => {
        const model = createModel();
        const postMetadata = model.getEntity(BlogPost);
        const posts = new Queryable(postMetadata, new RecordingExecutor());

        const byAuthor = posts
            .join('author', { metadata: model.getEntity(Author) }, ({ root, author }) => root.authorId.eq(author.id))
            .groupBy(({ author }) => ({ authorEmail: author.email }))
            .select(group => ({
                authorEmail: group.key.authorEmail,
                latestPostAt: group.max(({ root }) => root.createdAt),
            }));
        const byWorkspace = posts
            .join('workspace', { metadata: model.getEntity(Workspace) }, ({ root, workspace }) => root.workspaceId.eq(workspace.id))
            .groupBy(({ workspace }) => ({ workspaceName: workspace.name }))
            .select(group => ({
                workspaceName: group.key.workspaceName,
                latestPostAt: group.max(({ root }) => root.createdAt),
            }));

        const authorKey = buildSelectSqlCacheKey(postMetadata, byAuthor.toQueryModel());
        const workspaceKey = buildSelectSqlCacheKey(postMetadata, byWorkspace.toQueryModel());

        expect(authorKey).not.toBe(workspaceKey);
        expect(JSON.parse(authorKey)).toMatchObject({
            groupKeys: [{
                alias: 'authorEmail',
                sourceAlias: 'author',
                propertyName: 'email',
            }],
            groupKeyProjection: [{
                alias: 'authorEmail',
                keyAlias: 'authorEmail',
                sourceAlias: 'author',
                propertyName: 'email',
            }],
            aggregateProjection: [{
                alias: 'latestPostAt',
                function: 'max',
                sourceAlias: 'root',
                propertyName: 'createdAt',
            }],
        });
    });
});
