import { buildRawSql } from '@entitykit/core/adapter';
import type { SqlStatement as RawSqlStatement } from '@entitykit/core/adapter';
import { mySqlDialect as rawSqlDialect } from './mysql-dialect';

/** Build a standalone MySQL statement with `?` placeholders. */
export function rawSql(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
): RawSqlStatement {
    return buildRawSql(rawSqlDialect, strings, ...values);
}

export { mySqlProviderServices } from './mysql-provider-services';
export { createMySqlDataSource } from './mysql-data-source';
export type {
    DriverOptions,
    DatabaseTlsOptions,
    DatabaseTlsVersion,
    MySqlConnectionConfig,
    MySqlPoolOptions,
} from '@entitykit/core';
export type { DatabaseOperationOptions, TransactionOptions } from '@entitykit/core/adapter';
export type { DatabaseConnectionSource, DatabaseDataSource } from '@entitykit/core/adapter';
export type {
    DatabaseProviderConnectionConfig,
    DatabaseRuntimeProviderServices,
    DatabaseSchemaIntrospector,
} from '@entitykit/core/adapter';
export { MySqlDatabaseConnection } from './mysql-database-connection';
export { mySqlDialect } from './mysql-dialect';
export { mySqlMigrationDialect } from './mysql-migration-dialect';
export { mySqlValueReader } from './mysql-value-reader';
export { MySqlSchemaIntrospector } from './mysql-schema-introspector';
export type { MySqlSchemaIntrospectionOptions } from './mysql-schema-introspector';
export type {
    EntityKitContextFactory,
    EntityKitDataSource,
    EntityKitDataSourceOptions,
} from '@entitykit/core/adapter';
export type { RetryAttempt, RetryExecutionOptions, RetryPolicyOptions } from '@entitykit/core/adapter';
export type {
    DatabaseConnection,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionIsolationLevel,
} from '@entitykit/core/adapter';
export type { DatabaseProviderServices } from '@entitykit/core/adapter';
export type { SqlStatement } from '@entitykit/core/adapter';
export type { AlterColumnChange, SchemaSqlDialect, SqlDialect, SqlSequenceDefinition } from '@entitykit/core/adapter';
export type { IdentityColumnOptions, IdentityGenerationMode, RowIdColumnOptions, StoreGenerationStrategy } from '@entitykit/core/adapter';
export type {
    MigrationBuilder,
    MigrationBuilderConstructor,
    MigrationBuilderFactory,
    MigrationColumnBuilder,
    MigrationTableBuilder,
    MigrationTableCallback,
} from '@entitykit/core/adapter';
export type {
    MigrationAlterColumnDefinition,
    MigrationBuilderOptions,
    MigrationCheckConstraint,
    MigrationColumnDefinition,
    MigrationCreateTableOptions,
    MigrationDropIndexOptions,
    MigrationForeignKeyDefinition,
    MigrationIndexDefinition,
    MigrationIndexKeyPart,
    MigrationSequenceDefinition,
    MigrationSqlOptions,
    MigrationStatement,
    MigrationTableCopyColumn,
    MigrationTableForeignKey,
    MigrationTableRebuildDefinition,
    MigrationTableShape,
} from '@entitykit/core/adapter';
export type { MigrationIdentity, MigrationSqlDialect } from '@entitykit/core/adapter';
export type {
    DatabaseCheckConstraint,
    DatabaseColumn,
    DatabaseForeignKey,
    DatabaseIndex,
    DatabaseIndexKeyPart,
    DatabasePrimaryKey,
    DatabaseSchema,
    DatabaseSchemaIntrospectionOptions,
    DatabaseSchemaSnapshot,
    DatabaseSequence,
    DatabaseTable,
} from '@entitykit/core/adapter';
export type { StoreValueReader } from '@entitykit/core/adapter';
