/**
 * `entitykit/sqlite` — the built-in SQLite adapter, backed by Node's `node:sqlite`
 * (`DatabaseSync`, unflagged on Node >= 22.13). Use it through the provider seam:
 *
 * ```ts
 * import { sqliteProviderServices } from "entitykit/sqlite";
 * // options.useProvider(sqliteProviderServices, ":memory:")
 * ```
 */
import { buildRawSql } from '../../sql/raw-sql';
import type { SqlStatement as RawSqlStatement } from '../../sql/sql-statement';
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
export type { SqliteConnectionConfig } from '../../storage/built-in-provider-config';
export type { DatabaseOperationOptions, TransactionOptions } from '../../storage/database-connection';
export type { DatabaseConnectionSource, DatabaseDataSource } from '../../storage/database-data-source';
export type {
    DatabaseProviderConnectionConfig,
    DatabaseRuntimeProviderServices,
    DatabaseSchemaIntrospector,
} from '../../storage/database-provider-services';
export { defaultSqliteBusyTimeoutMs } from './sqlite-database-connection';
export { sqliteDialect, sqliteMigrationDialect } from './sqlite-dialect';
export { sqliteValueReader } from './sqlite-value-reader';
export { SqliteSchemaIntrospector } from './sqlite-schema-introspector';
export type { SqliteSchemaIntrospectionOptions } from './sqlite-schema-introspector';
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
