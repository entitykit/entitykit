import { DbContext } from '../../core/db-context';
import type { DbContextOptionsBuilder } from '../../core/context-options/db-context-options-builder';
import type { DatabaseConnection } from '../../storage/database-connection';
import type { ModelBuilder } from '../../model/model-builder';
import { DeleteBehavior } from '../../model/relationship-metadata';
import { BlogPost } from './blog-post';
import { BlogUser } from './blog-user';
import { Comment } from './comment';
import { Membership } from './membership';
import { Tag } from './tag';
import { Workspace } from './workspace';

export class BlogSaasDbContext extends DbContext {
    private static connectionOverride?: DatabaseConnection;

    public static useConnectionForTests(connection?: DatabaseConnection): void {
        BlogSaasDbContext.connectionOverride = connection;
    }

    public workspaces = this.set(Workspace);
    public users = this.set(BlogUser);
    public memberships = this.set(Membership);
    public posts = this.set(BlogPost);
    public comments = this.set(Comment);
    public tags = this.set(Tag);

    protected override configure(options: DbContextOptionsBuilder): void {
        if (BlogSaasDbContext.connectionOverride) {
            options.useConnection(BlogSaasDbContext.connectionOverride);
            return;
        }

        options.usePostgres(process.env.DATABASE_URL ?? 'postgres://localhost/entitykit_blog_saas');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Workspace, entity => {
            entity.toTable('workspaces');
            entity.hasKey(workspace => workspace.id);
            entity.property(workspace => workspace.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(workspace => workspace.slug).hasColumnName('slug').hasColumnType('text').isRequired();
            entity.property(workspace => workspace.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(workspace => workspace.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired().hasDefaultSql('now()');
            entity.ignore(workspace => workspace.memberships);
            entity.ignore(workspace => workspace.posts);
            entity.hasIndex(workspace => workspace.slug).isUnique().hasDatabaseName('ux_workspaces_slug');
        });

        model.entity(BlogUser, entity => {
            entity.toTable('blog_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.displayName).hasColumnName('display_name').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired().hasDefaultSql('now()');
            entity.ignore(user => user.memberships);
            entity.ignore(user => user.posts);
            entity.hasIndex(user => user.email).isUnique().hasDatabaseName('ux_blog_users_email');
        });

        model.entity(Membership, entity => {
            entity.toTable('memberships');
            entity.hasKey(membership => membership.id);
            entity.property(membership => membership.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(membership => membership.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(membership => membership.userId).hasColumnName('user_id').hasColumnType('text').isRequired();
            entity.property(membership => membership.role).hasColumnName('role').hasColumnType('text').isRequired();
            entity.property(membership => membership.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired().hasDefaultSql('now()');
            entity.ignore(membership => membership.workspace);
            entity.ignore(membership => membership.user);
            entity.hasIndex(membership => [membership.workspaceId, membership.userId]).isUnique().hasDatabaseName('ux_memberships_workspace_user');
            entity.hasOne(Workspace, membership => membership.workspace)
                .withMany(workspace => workspace.memberships)
                .hasForeignKey(membership => membership.workspaceId)
                .onDelete(DeleteBehavior.Cascade);
            entity.hasOne(BlogUser, membership => membership.user)
                .withMany(user => user.memberships)
                .hasForeignKey(membership => membership.userId)
                .onDelete(DeleteBehavior.Cascade);
        });

        model.entity(BlogPost, entity => {
            entity.toTable('blog_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(post => post.slug).hasColumnName('slug').hasColumnType('text').isRequired();
            entity.property(post => post.body).hasColumnName('body').hasColumnType('text').isRequired();
            entity.property(post => post.publishedAt).hasColumnName('published_at').hasColumnType('timestamptz').isOptional();
            entity.property(post => post.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired().hasDefaultSql('now()');
            entity.property(post => post.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired().hasDefaultSql('now()');
            entity.ignore(post => post.workspace);
            entity.ignore(post => post.author);
            entity.ignore(post => post.comments);
            entity.ignore(post => post.tags);
            entity.hasIndex(post => [post.workspaceId, post.slug]).isUnique().hasDatabaseName('ux_blog_posts_workspace_slug');
            entity.hasIndex(post => [post.workspaceId, post.publishedAt]).hasDatabaseName('ix_blog_posts_workspace_published');
            entity.hasOne(Workspace, post => post.workspace)
                .withMany(workspace => workspace.posts)
                .hasForeignKey(post => post.workspaceId)
                .onDelete(DeleteBehavior.Cascade);
            entity.hasOne(BlogUser, post => post.author)
                .withMany(user => user.posts)
                .hasForeignKey(post => post.authorId)
                .onDelete(DeleteBehavior.NoAction);
            entity.hasManyToMany(Tag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('blog_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });

        model.entity(Comment, entity => {
            entity.toTable('comments');
            entity.hasKey(comment => comment.id);
            entity.property(comment => comment.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(comment => comment.postId).hasColumnName('post_id').hasColumnType('text').isRequired();
            entity.property(comment => comment.authorName).hasColumnName('author_name').hasColumnType('text').isRequired();
            entity.property(comment => comment.body).hasColumnName('body').hasColumnType('text').isRequired();
            entity.property(comment => comment.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired().hasDefaultSql('now()');
            entity.ignore(comment => comment.post);
            entity.hasIndex(comment => comment.postId).hasDatabaseName('ix_comments_post_id');
            entity.hasOne(BlogPost, comment => comment.post)
                .withMany(post => post.comments)
                .hasForeignKey(comment => comment.postId)
                .onDelete(DeleteBehavior.Cascade);
        });

        model.entity(Tag, entity => {
            entity.toTable('tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(tag => tag.slug).hasColumnName('slug').hasColumnType('text').isRequired();
            entity.ignore(tag => tag.posts);
            entity.ignore(tag => tag.workspace);
            entity.hasIndex(tag => [tag.workspaceId, tag.slug]).isUnique().hasDatabaseName('ux_tags_workspace_slug');
            entity.hasOne(Workspace, tag => tag.workspace)
                .hasForeignKey(tag => tag.workspaceId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}
