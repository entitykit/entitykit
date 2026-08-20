import { requireDefined } from './require-defined';
import type {
    DatabaseProviderConnectionConfig,
    DatabaseProviderServices,
    DatabaseSchemaIntrospector,
    SqlDialect,
    SqlStatement,
} from '../../packages/core/src/adapter';
import { type DatabaseSchemaSnapshot } from '../../packages/core/src/tooling';
import {
    MigrationBuilder,
    type Migration,
    type MigrationSqlDialect,
} from '../../packages/core/src/migrations/api';
import { RecordingDatabaseConnection } from './recording-database-connection';

export const fakeSqlDialect: SqlDialect = {
    name: 'fake-sql',
    quoteIdentifier(identifier: string): string {
        if (!identifier || identifier.trim().length === 0) {
            throw new Error('SQL identifier cannot be empty.');
        }

        return `\`${identifier.replace(/`/g, '``')}\``;
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
        return 'on duplicate key ignore';
    },
};

export const fakeMigrationDialect: MigrationSqlDialect = {
    name: 'fake-migration-sql',
    sql: fakeSqlDialect,
    createMigrationHistoryTableStatement(): SqlStatement {
        return {
            text: 'create table if not exists `entitykit_migrations` (`id` text primary key, `name` text not null, `checksum` text not null, `entitykit_version` text not null)',
            values: [],
        };
    },
    selectMigrationHistoryStatement(): SqlStatement {
        return {
            text: 'select `id`, `name`, `checksum`, `entitykit_version` from `entitykit_migrations` order by `id`',
            values: [],
        };
    },
    insertMigrationHistoryStatement(
        migration: Migration,
        checksum: string,
    ): SqlStatement {
        return {
            text: 'insert into `entitykit_migrations` (`id`, `name`, `checksum`, `entitykit_version`) values (?, ?, ?, ?)',
            values: [migration.id, migration.name, checksum, 'fake-version'],
        };
    },
    deleteMigrationHistoryStatement(migration: Migration): SqlStatement {
        return {
            text: 'delete from `entitykit_migrations` where `id` = ?',
            values: [migration.id],
        };
    },
};

export interface FakeProviderOptions {
    readonly connection?: RecordingDatabaseConnection;
    readonly introspector?: DatabaseSchemaIntrospector;
}

export function createFakeProvider(options: FakeProviderOptions = {}): DatabaseProviderServices {
    return {
        name: 'fake-provider',
        dialect: fakeSqlDialect,
        migrationDialect: fakeMigrationDialect,
        createMigrationBuilder: () => new MigrationBuilder(fakeSqlDialect, {
            providerName: 'fake-provider',
            supportsConcurrentIndexes: false,
            supportsExtensions: false,
        }),
        createConnection(config: DatabaseProviderConnectionConfig) {
            const record = typeof config === 'string' ? undefined : config;
            const configuredConnection = record?.connection;
            if (configuredConnection instanceof RecordingDatabaseConnection) {
                return configuredConnection;
            }

            return options.connection ?? new RecordingDatabaseConnection();
        },
        createSchemaIntrospector: options.introspector
            ? () => requireDefined(options.introspector)
            : undefined,
    };
}

export const emptyFakeSchemaIntrospector: DatabaseSchemaIntrospector = {
    async introspect(): Promise<DatabaseSchemaSnapshot> {
        return Promise.resolve({ schemas: [] });
    },
};
