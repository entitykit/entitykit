import { requireDefined } from '../support/require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../../packages/core/src';
import {
    DbContext,
    type RuntimeDiagnosticEvent,
    type RuntimeDiagnosticsHandler,
} from '../../packages/core/src';
import type { SqlDialect } from '../../packages/core/src/adapter';
import type { MigrationBuilder } from '../../packages/core/src/migrations/api';
import { Migration } from '../../packages/core/src/migrations/api';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';

export class User {
    public id!: string;
    public posts!: Post[];
}

export class Post {
    public id!: string;
    public authorId!: string;
    public author!: User;
}

export class DiagnosticsMigration extends Migration {
    public readonly id = '20260601120000_DiagnosticsMigration';
    public readonly name = 'DiagnosticsMigration';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('diagnostic_users', [
            { name: 'id', type: 'text', primaryKey: true },
        ]);
    }
}

export class DiagnosticsContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static events: RuntimeDiagnosticEvent[] = [];
    public static dialect: SqlDialect | undefined;
    public static includeSensitiveData = true;
    public static handler: RuntimeDiagnosticsHandler = event => {
        DiagnosticsContext.events.push(event);
    };

    public users = this.set(User);
    public posts = this.set(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useConnection(
                DiagnosticsContext.connection,
                {
                    provider: 'diagnostic-test',
                    dialect: DiagnosticsContext.dialect,
                },
            )
            .useDiagnostics(
                (event): void | Promise<void> => DiagnosticsContext.handler(event),
                { includeSensitiveData: DiagnosticsContext.includeSensitiveData },
            );
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
            entity
                .hasOne(User, post => post.author)
                .withMany(user => user.posts)
                .hasForeignKey(post => post.authorId);
        });
    }
}

export const fallbackDialect: SqlDialect = {
    name: 'diagnostic-fallback',
    quoteIdentifier(identifier: string): string {
        return `[${identifier}]`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        return identifiers
            .filter(Boolean)
            .map(identifier => this.quoteIdentifier(requireDefined(identifier)))
            .join('.');
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

export function resetDiagnosticsContext(): void {
    DiagnosticsContext.connection = new RecordingDatabaseConnection();
    DiagnosticsContext.events = [];
    DiagnosticsContext.dialect = undefined;
    DiagnosticsContext.includeSensitiveData = true;
    DiagnosticsContext.handler = event => {
        DiagnosticsContext.events.push(event);
    };
}
