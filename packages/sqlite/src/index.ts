/**
 * `entitykit/sqlite` — the built-in SQLite adapter, backed by Node's `node:sqlite`
 * (`DatabaseSync`, unflagged on Node >= 22.13). Use it through the provider seam:
 *
 * ```ts
 * import { sqliteProviderServices } from "entitykit/sqlite";
 * // options.useProvider(sqliteProviderServices, ":memory:")
 * ```
 */
import { buildRawSql } from '@entitykit/core/adapter';
import type { SqlStatement as RawSqlStatement } from '@entitykit/core/adapter';
import { sqliteDialect as rawSqlDialect } from './sqlite-dialect';

/** Build a standalone SQLite statement with `?` placeholders. */
export function rawSql(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
): RawSqlStatement {
    return buildRawSql(rawSqlDialect, strings, ...values);
}

export { sqliteProviderServices } from './sqlite-provider-services';
export { createSqliteDataSource } from './sqlite-data-source';
export { SqliteDatabaseConnection } from './sqlite-database-connection';
export type { SqliteConnectionConfig } from '@entitykit/core';
export type { DatabaseOperationOptions, TransactionOptions } from '@entitykit/core/adapter';
export type { DatabaseConnectionSource, DatabaseDataSource } from '@entitykit/core/adapter';
export type {
    DatabaseProviderConnectionConfig,
    DatabaseRuntimeProviderServices,
    DatabaseSchemaIntrospector,
} from '@entitykit/core/adapter';
export { defaultSqliteBusyTimeoutMs } from './sqlite-database-connection';
export { sqliteDialect, sqliteMigrationDialect } from './sqlite-dialect';
export { sqliteValueReader } from './sqlite-value-reader';
export { SqliteSchemaIntrospector } from './sqlite-schema-introspector';
export type { SqliteSchemaIntrospectionOptions } from './sqlite-schema-introspector';
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
