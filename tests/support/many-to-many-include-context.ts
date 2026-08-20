import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import type { SqlDialect } from '../../packages/core/src/adapter';
import type { RecordingDatabaseConnection } from './recording-database-connection';

export class Tag {
    public id!: string;
    public workspaceId!: string;
    public name!: string;
    public deletedAt?: Date | null;
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

export class IncludeManyToManyContext extends DbContext {
    public posts = this.set(Post);
    public tags = this.set(Tag);

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly injectedDialect?: SqlDialect,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        if (this.injectedDialect) {
            options.useConnection(this.connection, {
                provider: this.injectedDialect.name,
                dialect: this.injectedDialect,
            });
        } else options.useConnection(this.connection);
        options.useTenantScope(() => 'wrk_1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id')
                .hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title')
                .hasColumnType('text').isRequired();
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
            entity.tenantKey(tag => tag.workspaceId);
            entity.softDelete(tag => tag.deletedAt);
            entity.property(tag => tag.id).hasColumnName('id')
                .hasColumnType('text').isRequired();
            entity.property(tag => tag.workspaceId).hasColumnName('workspace_id')
                .hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name')
                .hasColumnType('text').isRequired();
            entity.property(tag => tag.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('timestamptz');
        });
    }

    public static createWith(
        connection: RecordingDatabaseConnection,
        dialect?: SqlDialect,
    ): IncludeManyToManyContext {
        return IncludeManyToManyContext.create(connection, dialect);
    }
}
