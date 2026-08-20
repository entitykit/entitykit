import { PostgresSchemaIntrospector } from './postgres-schema-introspector';
import { MigrationBuilder } from '@entitykit/core/migrations';
import { postgresMigrationDialect } from '@entitykit/core/migrations';
import { postgresDialect } from '@entitykit/core/adapter';
import type { DatabaseConnection } from '@entitykit/core/adapter';
import type { DatabaseProviderConnectionConfig, DatabaseProviderServices, DatabaseSchemaIntrospector } from '@entitykit/core/adapter';
import { PostgresDatabaseConnection } from './pg-database-connection';
import { PostgresConnectionSource } from './postgres-connection-source';
import { DatabaseProviderError, DatabaseTransactionCleanupError } from '@entitykit/core/adapter';
import type { PostgresConnectionConfig } from '@entitykit/core';
import { isTransactionOutcomeUnknown } from '@entitykit/core/adapter';

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
        if (isTransactionOutcomeUnknown(error)) {
            return false;
        }
        const candidate = error instanceof DatabaseTransactionCleanupError
            ? error.primaryError
            : error;
        if (!(candidate instanceof DatabaseProviderError)) {
            return false;
        }
        const code = candidate.code;
        if (candidate.operation === 'commit') {
            return code === '40001' || code === '40P01';
        }
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
