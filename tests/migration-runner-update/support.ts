import type { MigrationDiagnosticEvent, RuntimeDiagnosticEvent } from '../../src';
import type { SqlDialect } from '../../src/adapter';
import type { MigrationBuilder } from '../../src/migrations/api';
import { Migration, type MigrationSqlDialect } from '../../src/migrations/api';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';

export { RecordingDatabaseConnection };

export class CreateUsers extends Migration {
    public readonly id = '20260601120000_CreateUsers';
    public readonly name = 'CreateUsers';
    public override up(builder: MigrationBuilder): void {
        builder.createTable('users', [{ name: 'id', type: 'uuid', primaryKey: true }]);
    }
    public override down(builder: MigrationBuilder): void {
        builder.dropTable('users');
    }
}

export class AddPosts extends Migration {
    public readonly id = '20260601130000_AddPosts';
    public readonly name = 'AddPosts';
    public override up(builder: MigrationBuilder): void {
        builder.createTable('posts', [{ name: 'id', type: 'uuid', primaryKey: true }]);
    }
    public override down(builder: MigrationBuilder): void {
        builder.dropTable('posts');
    }
}

export class ConcurrentIndex extends Migration {
    public readonly id = '20260601140000_ConcurrentIndex';
    public readonly name = 'ConcurrentIndex';
    public override up(builder: MigrationBuilder): void {
        builder.addColumn('users', { name: 'email', type: 'text' });
        builder.createIndex({ name: 'ix_users_email', tableName: 'users', columns: ['email'], concurrently: true });
        builder.addColumn('users', { name: 'name', type: 'text' });
    }
}

export class FailsInsideTransaction extends Migration {
    public readonly id = '20260601150000_FailsInsideTransaction';
    public readonly name = 'FailsInsideTransaction';
    public override up(builder: MigrationBuilder): void {
        builder.sql('select before_failure');
        builder.sql('select fail_inside_transaction');
    }
}

export class FailsAfterTransactionSuppressedStatement extends Migration {
    public readonly id = '20260601160000_FailsAfterTransactionSuppressedStatement';
    public readonly name = 'FailsAfterTransactionSuppressedStatement';
    public override up(builder: MigrationBuilder): void {
        builder.sql('select before_suppressed');
        builder.sql('create index concurrently ix_users_email on users (email)', { suppressTransaction: true });
        builder.sql('select fail_after_suppressed');
    }
}

export const questionMarkSqlDialect: SqlDialect = {
    name: 'question-mark-sql',
    quoteIdentifier(identifier: string): string {
        if (!identifier || identifier.trim().length === 0) {
            throw new Error('SQL identifier cannot be empty.');
        }

        return `[${identifier.replace(/]/g, ']]')}]`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        const parts = identifiers.filter((identifier): identifier is string => Boolean(identifier));
        if (parts.length === 0) {
            throw new Error('SQL identifier cannot be empty.');
        }

        return parts.map(part => this.quoteIdentifier(part)).join('.');
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

export const noLockMigrationDialect: MigrationSqlDialect = {
    name: 'no-lock-test',
    sql: questionMarkSqlDialect,
    createMigrationHistoryTableStatement() {
        return {
            text: 'create table if not exists [migrations] ([id] text primary key, [name] text not null, [checksum] text not null, [entitykit_version] text not null)',
            values: [],
        };
    },
    selectMigrationHistoryStatement() {
        return {
            text: 'select [id], [name], [checksum], [entitykit_version] from [migrations] order by [id]',
            values: [],
        };
    },
    insertMigrationHistoryStatement(migration: Migration, checksum: string) {
        return {
            text: 'insert into [migrations] ([id], [name], [checksum], [entitykit_version]) values (?, ?, ?, ?)',
            values: [migration.id, migration.name, checksum, 'test-version'],
        };
    },
    deleteMigrationHistoryStatement(migration: Migration) {
        return {
            text: 'delete from [migrations] where [id] = ?',
            values: [migration.id],
        };
    },
};

export function migrationDiagnostics(): {
    readonly events: RuntimeDiagnosticEvent[];
    readonly options: { readonly provider: string; readonly diagnostics: readonly [(event: RuntimeDiagnosticEvent) => void] };
} {
    const events: RuntimeDiagnosticEvent[] = [];
    return {
        events,
        options: {
            provider: 'postgres',
            diagnostics: [event => {
                events.push(event);
            }],
        },
    };
}

export function migrationEvents(events: readonly RuntimeDiagnosticEvent[]): MigrationDiagnosticEvent[] {
    return events.filter((event): event is MigrationDiagnosticEvent => event.kind === 'migration');
}
