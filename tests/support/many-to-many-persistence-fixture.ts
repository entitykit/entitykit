import type {
    DbContextOptionsBuilder } from '../../packages/core/src';
import {
    DbContext,
    type ModelBuilder,
} from '../../packages/core/src';
import type { RecordingDatabaseConnection } from './recording-database-connection';

export class Tag {
    public id!: string;
    public name!: string;
    public posts: Post[] = [];

    constructor(data?: Partial<Tag>) {
        Object.assign(this, data);
    }
}

export class Post {
    public id!: string;
    public title!: string;
    public tags: Tag[] = [];

    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

export class ManyToManyContext extends DbContext {
    public posts = this.set(Post);
    public tags = this.set(Tag);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.hasManyToMany(Tag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });

        model.entity(Tag, entity => {
            entity.toTable('tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }

    public static createWith(
        connection: RecordingDatabaseConnection,
    ): ManyToManyContext {
        const context = ManyToManyContext.create(connection);
        return context;
    }
}

export function createPost(id = 'post_1'): Post {
    return new Post({ id, title: id === 'post_1' ? 'Hello' : 'Second' });
}

export function createTag(id = 'tag_1'): Tag {
    return new Tag({
        id,
        name: id === 'tag_1' ? 'TypeScript' : 'Postgres',
    });
}
