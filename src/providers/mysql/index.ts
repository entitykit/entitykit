import { buildRawSql } from '../../sql/raw-sql';
import type { SqlStatement as RawSqlStatement } from '../../sql/sql-statement';
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
} from '../../storage/built-in-provider-config';
export type { DatabaseOperationOptions, TransactionOptions } from '../../storage/database-connection';
export type { DatabaseConnectionSource, DatabaseDataSource } from '../../storage/database-data-source';
export type {
    DatabaseProviderConnectionConfig,
    DatabaseRuntimeProviderServices,
    DatabaseSchemaIntrospector,
} from '../../storage/database-provider-services';
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
} from '../../storage/entity-kit-data-source-types';
export type { RetryAttempt, RetryExecutionOptions, RetryPolicyOptions } from '../../storage/data-source-retry';
export type {
    DatabaseConnection,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionIsolationLevel,
} from '../../storage/database-connection';
export type { DatabaseProviderServices } from '../../storage/database-provider-services';
export type { SqlStatement } from '../../sql/sql-statement';
export type { AlterColumnChange, SchemaSqlDialect, SqlDialect, SqlSequenceDefinition } from '../../sql/sql-dialect';
export type { IdentityColumnOptions, IdentityGenerationMode, RowIdColumnOptions, StoreGenerationStrategy } from '../../model/store-generation';
export type {
    MigrationBuilder,
    MigrationBuilderConstructor,
    MigrationBuilderFactory,
    MigrationColumnBuilder,
    MigrationTableBuilder,
    MigrationTableCallback,
} from '../../migrations/migration-builder-contract';
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
} from '../../migrations/migration-builder-types';
export type { MigrationIdentity, MigrationSqlDialect } from '../../migrations/migration-sql-dialect';
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
} from '../../introspection/database-schema';
export type { StoreValueReader } from '../../storage/store-value-reader';
