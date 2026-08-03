import { MigrationBuilder } from '../../migrations/migration-builder';
import type { DatabaseConnection } from '../../storage/database-connection';
import type { DatabaseProviderConnectionConfig, DatabaseProviderServices, DatabaseSchemaIntrospector } from '../../storage/database-provider-services';
import { MySqlDatabaseConnection } from './mysql-database-connection';
import { mySqlDialect } from './mysql-dialect';
import { mySqlMigrationDialect } from './mysql-migration-dialect';
import { MySqlSchemaIntrospector } from './mysql-schema-introspector';
import { mySqlValueReader } from './mysql-value-reader';
import { MySqlConnectionSource } from './mysql-connection-source';
import { DatabaseProviderError, DatabaseTransactionCleanupError } from '../../storage/database-errors';
import type { MySqlConnectionConfig } from '../../storage/built-in-provider-config';
import { isTransactionOutcomeUnknown } from '../../storage/transaction-outcome';

export type { MySqlConnectionConfig } from './mysql-driver';

/**
 * Provider services for the built-in MySQL adapter (on `mysql2`).
 */
export const mySqlProviderServices: DatabaseProviderServices<MySqlConnectionConfig> = Object.freeze({
    name: 'mysql',
    dialect: mySqlDialect,
    migrationDialect: mySqlMigrationDialect,
    valueReader: mySqlValueReader,
    createMigrationBuilder() {
        return new MigrationBuilder(mySqlDialect, {
            providerName: 'mysql',
            supportsTransactionalDdl: false,
            // MySQL cannot build an index concurrently, but it can alter table
            // constraints and columns, unlike SQLite.
            supportsConcurrentIndexes: false,
            supportsAlterTableConstraints: true,
            supportsColumnAlteration: true,
            // MySQL renames an index only through `alter table ... rename index`,
            // which needs the table name the renameIndex API does not carry.
            supportsRenameIndex: false,
            supportsExtensions: false,
        });
    },
    createConnection(config: DatabaseProviderConnectionConfig<MySqlConnectionConfig>): DatabaseConnection {
        return new MySqlDatabaseConnection(config);
    },
    createDataSource(config: DatabaseProviderConnectionConfig<MySqlConnectionConfig>) {
        return new MySqlConnectionSource(config);
    },
    isTransientError(error: unknown): boolean {
        if (isTransactionOutcomeUnknown(error)) {
            return false;
        }
        const candidate = error instanceof DatabaseTransactionCleanupError
            ? error.primaryError
            : error;
        if (
            candidate instanceof DatabaseProviderError &&
            candidate.operation === 'commit'
        ) {
            return candidate.code === 'ER_LOCK_DEADLOCK';
        }
        return candidate instanceof DatabaseProviderError
            && candidate.code !== undefined
            && [
                'ER_LOCK_DEADLOCK',
                'ER_LOCK_WAIT_TIMEOUT',
                'ER_CON_COUNT_ERROR',
                'ER_SERVER_SHUTDOWN',
                'PROTOCOL_CONNECTION_LOST',
                'ECONNRESET',
                'ECONNREFUSED',
                'EPIPE',
                'ETIMEDOUT',
            ].includes(candidate.code);
    },
    createSchemaIntrospector(connection: DatabaseConnection): DatabaseSchemaIntrospector {
        return new MySqlSchemaIntrospector(connection);
    },
});
