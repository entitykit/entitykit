import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../../packages/core/src';
import {
    DbContext,
    enumString,
    type RuntimeDiagnosticEvent,
} from '../../packages/core/src';
import type { SqlDialect } from '../../packages/core/src/adapter';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';

export type AuthorStatus = 'active' | 'disabled';

export class Author {
    public id!: string;
    public email!: string;
    public status!: AuthorStatus;
}

export class BlogPost {
    public id!: string;
    public authorId!: string;
    public title!: string;
    public viewCount!: number;
    public createdAt!: Date;
}

export class ScopedAuthor {
    public id!: string;
    public workspaceId!: string;
    public email!: string;
    public deletedAt!: Date | null;
}

export class ScopedPost {
    public id!: string;
    public workspaceId!: string;
    public authorId!: string;
    public title!: string;
    public deletedAt!: Date | null;
}

export class AppDbContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static dialect?: SqlDialect;
    public static diagnostics: RuntimeDiagnosticEvent[] = [];

    public posts = this.set(BlogPost);
    public authors = this.set(Author);

    protected override configure(options: DbContextOptionsBuilder): void {
        if (AppDbContext.dialect) {
            options.useConnection(AppDbContext.connection, {
                provider: 'custom',
                dialect: AppDbContext.dialect,
            });
            options.useDiagnostics(event => {
                AppDbContext.diagnostics.push(event);
            });
            return;
        }

        options.useConnection(AppDbContext.connection);
        options.useDiagnostics(event => {
            AppDbContext.diagnostics.push(event);
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Author, entity => {
            entity.toTable('authors');
            entity.hasKey(author => author.id);
            entity.property(author => author.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(author => author.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(author => author.status).hasColumnName('status').hasColumnType('text').hasConversion(enumString<AuthorStatus>()).isRequired();
        });

        model.entity(BlogPost, entity => {
            entity.toTable('blog_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(post => post.viewCount).hasColumnName('view_count').hasColumnType('integer').isRequired();
            entity.property(post => post.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
        });
    }
}

export class ScopedDbContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static tenantId = 'wrk_1';

    public posts = this.set(ScopedPost);
    public authors = this.set(ScopedAuthor);

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useConnection(ScopedDbContext.connection)
            .useTenantScope(() => ScopedDbContext.tenantId);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ScopedAuthor, entity => {
            entity.toTable('scoped_authors');
            entity.hasKey(author => author.id);
            entity.property(author => author.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(author => author.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(author => author.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(author => author.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            entity.tenantKey(author => author.workspaceId);
            entity.softDelete(author => author.deletedAt);
        });

        model.entity(ScopedPost, entity => {
            entity.toTable('scoped_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(post => post.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            entity.tenantKey(post => post.workspaceId);
            entity.softDelete(post => post.deletedAt);
        });
    }
}

export function createDb(connection = new RecordingDatabaseConnection(), dialect?: SqlDialect): AppDbContext {
    AppDbContext.connection = connection;
    AppDbContext.dialect = dialect;
    AppDbContext.diagnostics = [];
    return AppDbContext.create();
}

export function createScopedDb(connection = new RecordingDatabaseConnection()): ScopedDbContext {
    ScopedDbContext.connection = connection;
    ScopedDbContext.tenantId = 'wrk_1';
    return ScopedDbContext.create();
}
