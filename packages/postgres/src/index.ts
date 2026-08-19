/**
 * `entitykit/postgres` — the built-in Postgres adapter surface.
 *
 * This barrel is the in-package boundary that mirrors the planned
 * `entitykit-postgres` package. Import concrete Postgres services, the
 * connection, schema introspection, query helpers, and the Postgres dialects
 * from here (or use `options.usePostgres(...)` in a context), so a
 * later physical package split is a mechanical move rather than a rewrite.
 */
import { buildRawSql } from '../../sql/raw-sql';
import { postgresDialect as rawSqlDialect } from '../../sql/postgres-dialect';
import type { SqlStatement as RawSqlStatement } from '../../sql/sql-statement';

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
} from '../../storage/built-in-provider-config';
export type { DatabaseOperationOptions, TransactionOptions } from '../../storage/database-connection';
export type { DatabaseConnectionSource, DatabaseDataSource } from '../../storage/database-data-source';
export type {
    DatabaseProviderConnectionConfig,
    DatabaseRuntimeProviderServices,
    DatabaseSchemaIntrospector,
} from '../../storage/database-provider-services';
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
export { postgresDialect } from '../../sql/postgres-dialect';
export { postgresMigrationDialect } from '../../migrations/migration-sql-dialect';
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
export type { StoreValueReader } from '../../storage/store-value-reader';
export type { EntityConstructor } from '../../types';
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
export type { PredicateExpression } from '../../query/predicate-types';
export type { QueryField, QueryFieldOperand, QueryProxy } from '../../query/query-field-types';
export type { OrderExpression, SortDirection } from '../../query/expression';
export type { DateBucketGroupKey, DateBucketPrecision } from '../../query/aggregate';
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
export type { EntityPropertyKey, EntityUpdateValue, EntityUpdateValues } from '../../types';
export type { ModelPropertySelector, ModelPropertyToken, PropertySelector } from '../../model/model-property-selector';
