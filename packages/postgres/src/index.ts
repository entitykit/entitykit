/**
 * `entitykit/postgres` — the built-in Postgres adapter surface.
 *
 * This barrel is the in-package boundary that mirrors the planned
 * `entitykit-postgres` package. Import concrete Postgres services, the
 * connection, schema introspection, query helpers, and the Postgres dialects
 * from here (or use `options.usePostgres(...)` in a context), so a
 * later physical package split is a mechanical move rather than a rewrite.
 */
import { buildRawSql } from '@entitykit/core/adapter';
import { postgresDialect as rawSqlDialect } from '@entitykit/core/adapter';
import type { SqlStatement as RawSqlStatement } from '@entitykit/core/adapter';

/** Build a standalone Postgres statement with `$1` placeholders. */
export function rawSql(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
): RawSqlStatement {
    return buildRawSql(rawSqlDialect, strings, ...values);
}

export { postgresProviderServices } from './postgres-provider-services';
export { createPostgresDataSource } from './postgres-data-source';
export { PostgresDatabaseConnection } from './pg-database-connection';
export type {
    DriverOptions,
    DatabaseTlsOptions,
    DatabaseTlsVersion,
    PostgresConnectionConfig,
    PostgresPoolOptions,
} from '@entitykit/core';
export type { DatabaseOperationOptions, TransactionOptions } from '@entitykit/core/adapter';
export type { DatabaseConnectionSource, DatabaseDataSource } from '@entitykit/core/adapter';
export type {
    DatabaseProviderConnectionConfig,
    DatabaseRuntimeProviderServices,
    DatabaseSchemaIntrospector,
} from '@entitykit/core/adapter';
export { PostgresSchemaIntrospector } from './postgres-schema-introspector';
export type { PostgresSchemaIntrospectionOptions } from './postgres-schema-introspector';
export { postgres } from './postgres-query-helpers';
export type {
    PostgresDateBucketOptions,
    PostgresDeleteStatementOptions,
    PostgresEntitySet,
    PostgresQueryHelpers,
    PostgresUpdateStatementOptions,
    PostgresUpsertOptions,
} from './postgres-query-helpers';
export { postgresDialect } from '@entitykit/core/adapter';
export { postgresMigrationDialect } from '@entitykit/core/migrations';
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
export type { StoreValueReader } from '@entitykit/core/adapter';
export type { EntityConstructor } from '@entitykit/core';
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
export type { PredicateExpression } from '@entitykit/core';
export type { QueryField, QueryFieldOperand, QueryProxy } from '@entitykit/core';
export type { OrderExpression, SortDirection } from '@entitykit/core';
export type { DateBucketGroupKey, DateBucketPrecision } from '@entitykit/core';
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
export type { EntityPropertyKey, EntityUpdateValue, EntityUpdateValues } from '@entitykit/core';
export type { ModelPropertySelector, ModelPropertyToken, PropertySelector } from '@entitykit/core';
