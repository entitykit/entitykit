import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import type { RelationshipMetadata } from '../packages/core/src/model/relationship-metadata';
import type { IncludeLoaderContext } from '../packages/core/src/query/include-loader-context';
import { IncludeStitcher } from '../packages/core/src/query/include-loader-stitch';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { requireDefined } from './support/require-defined';

class User {
    public id!: string;
    public email!: string;
    public posts!: Post[];

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class Post {
    public id!: string;
    public title!: string;
    public authorId!: string;
    public author!: User | null;

    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

class IncludeContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    public users = this.set(User);
    public posts = this.set(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(IncludeContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        });

        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.hasOne(User, post => post.author).withMany(user => user.posts).hasForeignKey(post => post.authorId);
        });
    }
}

function createDb(connection: RecordingDatabaseConnection): IncludeContext {
    IncludeContext.connection = connection;
    return IncludeContext.create();
}

describe('nested includes', () => {
    it('loads nested include paths with split queries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com' }], rowCount: 1 });
        connection.queueResult({ rows: [{ id: 'post_1', title: 'One', author_id: 'usr_1' }], rowCount: 1 });
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com' }], rowCount: 1 });
        const db =  createDb(connection);

        const users = await db.users
            .include(user => user.posts)
            .thenInclude(post => post.author)
            .toArray();

        expect(connection.statements).toEqual([
            { text: 'select "id", "email" from "users"', values: [] },
            { text: 'select "id", "title", "author_id" from "posts" where "author_id" in ($1)', values: ['usr_1'] },
            { text: 'select "id", "email" from "users" where "id" in ($1)', values: ['usr_1'] },
        ]);
        expect(users[0]?.posts[0]?.author).toBe(users[0]);
    });

    it('refuses to stitch a relationship that names no inverse navigation', () => {
        const model = new ModelBuilderImplementation()
            .entity(User, entity => {
                entity.toTable('users');
                entity.hasKey(user => user.id);
                entity.property(user => user.id).hasColumnType('text')
                    .isRequired();
            })
            .entity(Post, entity => {
                entity.toTable('posts');
                entity.hasKey(post => post.id);
                entity.property(post => post.id).hasColumnType('text')
                    .isRequired();
                entity.property(post => post.authorId)
                    .hasColumnName('author_id')
                    .hasColumnType('text').isRequired();
                entity.hasOne(User, post => post.author).withMany()
                    .hasForeignKey(post => post.authorId);
            })
            .build();
        const dependentMetadata =
            model.getEntity(Post) as unknown as EntityMetadata;
        const stitcher = new IncludeStitcher({} as IncludeLoaderContext);

        expect(() => stitcher.assignDependentsToPrincipals(
            model.getEntity(User),
            [],
            dependentMetadata,
            requireDefined(dependentMetadata.relationships[0]) as
                RelationshipMetadata<object, User>,
            [],
        )).toThrow(
            'Relationship \'author\' does not configure an inverse navigation.',
        );
    });
});
