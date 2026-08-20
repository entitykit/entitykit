import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public posts!: Post[];
}

class Post {
    public id!: string;
    public authorId!: string;
    public author!: User;
}

class IncludeContext extends DbContext {
    public static connection = new RecordingDatabaseConnection();

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
        });

        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.hasOne(User, post => post.author).withMany(user => user.posts).hasForeignKey(post => post.authorId);
        });
    }
}

describe('include query model', () => {
    it('records direct include expressions without changing base select SQL', () => {
        const db =  IncludeContext.create();

        const query = db.posts
            .include(post => post.author)
            .include(post => post.author)
            .where(post => post.id.eq('post_1'));

        expect(query.toPlan().includes).toEqual(['author']);
        expect(query.toSql()).toEqual({
            text: 'select "id", "author_id" from "posts" where "id" = $1',
            values: ['post_1'],
        });
    });
});

it('records nested include paths', () => {
    const db =  IncludeContext.create();

    const query = db.users
        .include(user => user.posts)
        .thenInclude(post => post.author);

    expect(query.toPlan().includes).toEqual(['posts', 'posts.author']);
});
