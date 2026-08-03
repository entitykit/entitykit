export { ContextConcurrentOperationError, ContextDisposedError, ContextNotInitializedError, DbValidationError, EntityKitError, ModelValidationError, OperationCanceledError, ProviderCapabilityError, QueryCompilationError, EntityNotFoundError, MultipleEntitiesFoundError, DbUpdateError, ForeignKeyConstraintError, NotNullConstraintError, TenantScopeUnavailableError, UniqueConstraintError, isEntityKitError } from './errors';
export type { DbUpdateErrorOptions, EntityKitErrorCode, EntityKitErrorJson, EntityKitErrorOptions } from './errors';
export type {
    EntityConstructor,
    EntityMaterializationValues,
    EntityMaterializer,
    EntityPropertyKey,
    EntityUpdateValue,
    EntityUpdateValues,
} from './types';
export type { EntityAuditConfiguration, EntityBuilder } from './model/entity-builder-types';
export { BaseEntityConfiguration } from './model/entity-type-configuration';
export type { EntityTypeConfiguration } from './model/entity-type-configuration';
export type { ModelBuilder } from './model/model-builder-types';
export type { PropertyBuilder } from './model/property-builder-types';
export type {
    ComplexPropertyBuilder,
    ComplexPropertyOptions,
} from './model/complex-property-builder-types';
export type { AlternateKeyBuilder, IndexBuilder } from './model/index-builder-types';
export type { SequenceDataType } from './model/sequence-metadata';
export type { SequenceBuilder } from './model/sequence-builder-types';
export {
    DeleteBehavior,
    RelationshipCardinality,
} from './model/relationship-metadata';
export type { ManyToManyJoinTableBuilder, ManyToManyRelationshipBuilder, RelationshipBuilder } from './model/relationship-builder-types';
export type { ValueConverter } from './model/value-converter';
export {
    valueConverter,
    enumString,
    numericAsString,
    numericAsNumber,
    bigintAsBigInt,
    bigintAsNumber,
    dateOnlyAsString,
    dateOnlyAsUtcDate,
} from './model/value-converter';
export type { IdentityColumnOptions, IdentityGenerationMode, RowIdColumnOptions, StoreGenerationStrategy } from './model/store-generation';
export { ValueGenerated } from './model/value-generated';
export type {
    ModelPropertyPathSelector,
    ModelPropertyPathToken,
    ModelPropertySelector,
    ModelPropertyToken,
    PropertyPathSelector,
    PropertyListSelector,
    PropertySelector,
} from './model/model-property-selector';
export type { AuditOptions, DbContextOptionsBuilder, LazyLoadingOptions, OutboxMessage, OutboxOptions, TenantScopeOptions } from './core/public-db-context-options';
export { lazy } from './core/lazy-loading';
export type { LazyNavigations } from './core/lazy-loading';
export type { DiagnosticsOptions, IncludeDiagnosticEvent, LazyLoadDiagnosticEvent, MigrationDiagnosticEvent, QueryDiagnosticEvent, QueryPlanDiagnosticEvent, QueryPlanShape, RuntimeDiagnosticEvent, RuntimeDiagnosticsHandler, SaveChangesDiagnosticEvent, SaveChangesDiagnosticPlanEntry, TransactionDiagnosticEvent } from './diagnostics/runtime-diagnostics';
export type { SaveChangesInterceptor, SavingChangesEvent, SavedChangesEvent, SaveChangesFailedEvent } from './interceptors/save-changes-interceptor';
export { DbContext } from './core/db-context';
export type { DatabaseFacade } from './core/database-facade-types';
export { DbUpdateConcurrencyError } from './core/db-update-concurrency-error';
export type { SavePlanEntry } from './core/db-context';
export type { DbSet, UpsertOptions } from './core/db-set-types';
export type { ChangeTracker } from './tracking/change-tracker-types';
export type { EntityEntry } from './tracking/entity-entry-types';
export type { EntityDatabaseValues } from './tracking/entity-database-values';
export type { ConcurrencyResolutionStrategy } from './tracking/entity-entry-concurrency-types';
export type { CollectionNavigationEntry, ReferenceNavigationEntry } from './tracking/navigation-entry-types';
export { EntityState } from './tracking/entity-state';

export type { PredicateExpression, HavingPredicateExpression } from './query/predicate-types';
export type { OrderExpression, SortDirection } from './query/expression';
export type { QueryField, QueryFieldOperand, QueryProxy } from './query/query-field-types';
export type { IncludeQueryable, Queryable, RawSqlQueryable } from './query/entity-query-types';
export type { AggregateProjectedQueryable, GroupedQueryable, ProjectedQuery, ProjectedQueryable } from './query/projected-query-types';
export type { JoinedGroupedQueryable, JoinedProjectedQueryable, JoinedQueryable } from './query/joined-query-types';
export type { QueryPlan, QueryPlanJoin } from './query/query-plan';
export type { JoinedProjectionProxy, JoinedQueryProxy, JoinTarget, NullableProjectionEntity } from './query/joined-proxy-types';
export type { ProjectionBuilder, ProjectionField, ProjectionLiteral, ProjectionLiteralValue, ProjectionProxy, ProjectionResult, ProjectionSelection, ProjectionSqlOperand, SqlExpression } from './query/projection';
export type { AggregateField, AggregateProxy, AggregateResult, AggregateSelection, ComparablePropertyKey, DateBucketGroupKey, DateBucketPrecision, GroupedAggregateProxy, GroupedAggregateResult, GroupedAggregateSelection, GroupKeyField, GroupKeyProxy, GroupKeyResult, GroupKeySelection, NumericPropertyKey } from './query/aggregate';
export type { AggregateFunction } from './query/aggregate-expression-types';
export type { AggregateOrderExpression } from './query/aggregate-order-types';
export type { IncludeNavigationExpression, IncludeProxy, NavigationElement } from './query/include-types';
export type { RelationNavigationExpression, RelationNavigationProxy, RelationPredicateSelector } from './query/relation-types';
export type { DebugSqlOptions } from './sql/debug-sql';
export type { SqlStatement } from './sql/sql-statement';
export { DatabaseProviderError, DatabaseTransactionCleanupError } from './storage/database-errors';
export type { DatabaseProviderErrorDetails, DatabaseProviderOperation } from './storage/database-errors';
export type { DatabaseConnection, DatabaseOperationOptions, DatabaseQueryResult, QueryStreamOptions, TransactionIsolationLevel, TransactionOptions } from './storage/database-connection';
export type { DatabaseTlsOptions, DatabaseTlsVersion, DriverOptions, MySqlConnectionConfig, MySqlPoolOptions, PostgresConnectionConfig, PostgresPoolOptions, SqliteConnectionConfig } from './storage/built-in-provider-config';
