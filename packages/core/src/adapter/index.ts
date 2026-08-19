/** Provider-neutral contracts for custom EntityKit adapters. */
export type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionIsolationLevel,
    TransactionOptions,
} from '../storage/database-connection';
export type {
    DatabaseDataSource,
    DatabaseConnectionSource,
} from '../storage/database-data-source';
export type {
    DatabaseProviderConnectionConfig,
    DatabaseProviderServices,
    DatabaseRuntimeProviderServices,
    DatabaseSchemaIntrospector,
} from '../storage/database-provider-services';
export type { StoreValueReader } from '../storage/store-value-reader';
export {
    createEntityKitDataSource,
    createEntityKitDataSource as createDataSource,
} from '../storage/entity-kit-data-source';
export type {
    EntityKitDataSource,
    EntityKitContextFactory,
    EntityKitDataSourceOptions,
} from '../storage/entity-kit-data-source-types';
export type {
    RetryAttempt,
    RetryExecutionOptions,
    RetryPolicyOptions,
} from '../storage/data-source-retry';
export {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
    findTransactionOutcomeUnknown,
    isTransactionOutcomeUnknown,
    TransactionOutcomeUnknownError,
} from '../storage/database-errors';
export { mapDatabaseProviderError } from '../errors/db-update-error';
export type {
    DatabaseProviderErrorDetails,
    DatabaseProviderOperation,
} from '../storage/database-errors';
export type {
    IdentityColumnOptions,
    IdentityGenerationMode,
    RowIdColumnOptions,
    StoreGenerationStrategy,
} from '../model/store-generation';
export type {
    AlterColumnChange,
    SchemaSqlDialect,
    SqlDialect,
    SqlSequenceDefinition,
} from '../sql/sql-dialect';
export type { SqlStatement } from '../sql/sql-statement';
export type { DebugSqlOptions } from '../sql/debug-sql';
export { buildRawSql } from '../sql/raw-sql';
export type {
    MigrationBuilder,
    MigrationBuilderConstructor,
    MigrationBuilderFactory,
    MigrationColumnBuilder,
    MigrationTableBuilder,
} from '../migrations/migration-builder-contract';
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
} from '../migrations/migration-builder-types';
export type { MigrationTableCallback } from '../migrations/migration-builder-contract';
export type { MigrationIdentity, MigrationSqlDialect } from '../migrations/migration-sql-dialect';
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
} from '../introspection/database-schema';

// Cancellation, transaction, and streaming primitives. An adapter cannot honour
// the `DatabaseConnection` contract without them, so they belong on the adapter
// surface rather than in core's internals: every built-in provider reaches for
// exactly these when it implements `query`, `stream`, and `transaction`.
export {
    awaitWithOperationCancellation,
    isOperationAborted,
    throwIfOperationAborted,
} from '../storage/operation-cancellation';
export { withOperationSignal } from '../storage/with-operation-signal';
export {
    isQueryAborted,
    queryStreamBatchSize,
    throwIfQueryAborted,
} from '../storage/query-stream-options';
export { EnclosingTransactionState } from '../storage/enclosing-transaction-state';
export { TransactionUsability } from '../storage/transaction-usability';
export { validateTransactionOptions } from '../storage/transaction-options';
export { validateProviderServices } from '../storage/database-provider-validation';
export { invokeDetachedObserver } from '../diagnostics/detached-observer';
export { excludedColumnMatchClause } from '../sql/upsert-clause-match';
// The Postgres dialect is provider-neutral SQL rendering that lives in core;
// adapters targeting Postgres-compatible engines compose it directly.
export { postgresDialect } from '../sql/postgres-dialect';
