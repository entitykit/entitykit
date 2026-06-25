import { MigrationBuilder } from '../../migrations/migration-builder';
import type { DatabaseConnection } from '../../storage/database-connection';
import type { DatabaseProviderConnectionConfig, DatabaseProviderServices, DatabaseSchemaIntrospector } from '../../storage/database-provider-services';
import { SqliteDatabaseConnection } from './sqlite-database-connection';
import { sqliteDialect, sqliteMigrationDialect } from './sqlite-dialect';
import { SqliteSchemaIntrospector } from './sqlite-schema-introspector';
import { sqliteValueReader } from './sqlite-value-reader';
import { DatabaseProviderError, DatabaseTransactionCleanupError } from '../../storage/database-errors';
import type { SqliteConnectionConfig } from '../../storage/built-in-provider-config';

export type { SqliteConnectionConfig } from './sqlite-database-connection';

/**
 * Provider services for the built-in SQLite adapter (Node's `node:sqlite`).
 */
export const sqliteProviderServices: DatabaseProviderServices<SqliteConnectionConfig> = Object.freeze({
    name: 'sqlite',
    dialect: sqliteDialect,
    migrationDialect: sqliteMigrationDialect,
    valueReader: sqliteValueReader,
    createMigrationBuilder() {
        return new MigrationBuilder(sqliteDialect, {
            providerName: 'sqlite',
            supportsConcurrentIndexes: false,
            // SQLite cannot add or drop constraints on an existing table; they may
            // only be declared in `create table`.
            supportsAlterTableConstraints: false,
            // SQLite cannot alter a column in place or rename an index.
            supportsColumnAlteration: false,
            supportsRenameIndex: false,
            supportsExtensions: false,
        });
    },
    createConnection(config: DatabaseProviderConnectionConfig<SqliteConnectionConfig>): DatabaseConnection {
        return new SqliteDatabaseConnection(config);
    },
    isTransientError(error: unknown): boolean {
        const candidate = error instanceof DatabaseTransactionCleanupError
            ? error.primaryError
            : error;
        if (!(candidate instanceof DatabaseProviderError)) {
            return false;
        }
        const numericCode = candidate.code ? Number(candidate.code) : Number.NaN;
        return numericCode % 256 === 5
            || numericCode % 256 === 6
            || /database is (locked|busy)/i.test(candidate.detail ?? '');
    },
    createSchemaIntrospector(connection: DatabaseConnection): DatabaseSchemaIntrospector {
        return new SqliteSchemaIntrospector(connection);
    },
});
