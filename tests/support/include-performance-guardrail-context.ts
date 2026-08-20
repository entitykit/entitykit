import { requireDefined } from './require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../../packages/core/src';
import {
    DbContext,
    type IncludeDiagnosticEvent,
    type RuntimeDiagnosticEvent,
} from '../../packages/core/src';
import type { SqlDialect } from '../../packages/core/src/adapter';
import type { RecordingDatabaseConnection } from './recording-database-connection';

class User {
    public id!: string;
    public email!: string;
    public posts!: Post[];
}

class Post {
    public id!: string;
    public title!: string;
    public authorId!: string | null;
    public workspaceId!: string;
    public deletedAt?: Date | null;
    public author!: User | null;
    public tags!: Tag[];
}

class Tag {
    public id!: string;
    public name!: string;
    public workspaceId!: string;
    public deletedAt?: Date | null;
    public posts!: Post[];
}

class IncludeGuardrailContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static dialect?: SqlDialect;
    public static events: RuntimeDiagnosticEvent[] = [];

    public users = this.set(User);
    public posts = this.set(Post);
    public tags = this.set(Tag);

    protected override configure(options: DbContextOptionsBuilder): void {
        if (IncludeGuardrailContext.dialect) {
            options.useConnection(
                IncludeGuardrailContext.connection,
                {
                    provider: 'include-guardrails',
                    dialect: IncludeGuardrailContext.dialect,
                },
            );
        } else {
            options.useConnection(IncludeGuardrailContext.connection, { provider: 'include-guardrails' });
        }

        options
            .useTenantScope(() => 'wrk_1')
            .useDiagnostics(event => {
                IncludeGuardrailContext.events.push(event);
            });
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
            entity.tenantKey(post => post.workspaceId);
            entity.softDelete(post => post.deletedAt);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text');
            entity.property(post => post.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(post => post.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            entity.hasOne(User, post => post.author).withMany(user => user.posts).hasForeignKey(post => post.authorId);
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
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(tag => tag.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(tag => tag.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
        });
    }
}

export const fallbackIncludeDialect: SqlDialect = {
    name: 'fallback-sql',
    quoteIdentifier(identifier: string): string {
        return `[${identifier}]`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        return identifiers.filter(Boolean).map(identifier => this.quoteIdentifier(requireDefined(identifier))).join('.');
    },
    parameter(): string {
        return '?';
    },
    countAllExpression(): string {
        return 'count(*)';
    },
    falsePredicate(): string {
        return '0 = 1';
    },
    insertConflictDoNothingClause(): string {
        return 'on conflict do nothing';
    },
};

export function createIncludeGuardrailDb(
    connection: RecordingDatabaseConnection,
    dialect?: SqlDialect,
): IncludeGuardrailContext {
    IncludeGuardrailContext.connection = connection;
    IncludeGuardrailContext.dialect = dialect;
    IncludeGuardrailContext.events = [];
    return IncludeGuardrailContext.create();
}

export function includeEvents(): IncludeDiagnosticEvent[] {
    return IncludeGuardrailContext.events.filter(
        (event): event is IncludeDiagnosticEvent => event.kind === 'include',
    );
}
