import { PostgresSchemaIntrospector } from './postgres-schema-introspector';
import { MigrationBuilder } from '../../migrations/migration-builder';
import { postgresMigrationDialect } from '../../migrations/migration-sql-dialect';
import { postgresDialect } from '../../sql/postgres-dialect';
import type { DatabaseConnection } from '../../storage/database-connection';
import type { DatabaseProviderConnectionConfig, DatabaseProviderServices, DatabaseSchemaIntrospector } from '../../storage/database-provider-services';
import { PostgresDatabaseConnection } from './pg-database-connection';
import { PostgresConnectionSource } from './postgres-connection-source';
import { DatabaseProviderError, DatabaseTransactionCleanupError } from '../../storage/database-errors';
import type { PostgresConnectionConfig } from '../../storage/built-in-provider-config';

export type { PostgresConnectionConfig } from './postgres-driver';

/** Built-in postgres provider services. */ export const postgresProviderServices: DatabaseProviderServices<PostgresConnectionConfig> = Object.freeze({
    name: 'postgres',
    dialect: postgresDialect,
    migrationDialect: postgresMigrationDialect,
    createMigrationBuilder() {
        return new MigrationBuilder(postgresDialect, {
            providerName: 'postgres',
            supportsConcurrentIndexes: true,
            supportsExtensions: true,
        });
    },
    createConnection(config: DatabaseProviderConnectionConfig<PostgresConnectionConfig>): DatabaseConnection {
        return new PostgresDatabaseConnection(config);
    },
    createDataSource(config: DatabaseProviderConnectionConfig<PostgresConnectionConfig>) {
        return new PostgresConnectionSource(config);
    },
    isTransientError(error: unknown): boolean {
        const candidate = error instanceof DatabaseTransactionCleanupError
            ? error.primaryError
            : error;
        if (!(candidate instanceof DatabaseProviderError)) {
            return false;
        }
        const code = candidate.code;
        return code !== undefined && (
            code.startsWith('08')
            || code.startsWith('53')
            || [
                '40001',
                '40P01',
                '55P03',
                '57P01',
                '57P02',
                '57P03',
                'ECONNREFUSED',
                'ECONNRESET',
                'EPIPE',
                'ETIMEDOUT',
            ].includes(code)
        );
    },
    createSchemaIntrospector(connection: DatabaseConnection): DatabaseSchemaIntrospector {
        return new PostgresSchemaIntrospector(connection);
    },
});
