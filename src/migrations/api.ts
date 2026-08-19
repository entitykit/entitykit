export { Migration } from './migration';
export { contextMigrations } from './context-migrations';
export type { ContextMigrations, MigrationContext } from './context-migrations';
export { MigrationBuilder } from './migration-builder-contract';
export type {
    MigrationBuilderConstructor,
    MigrationBuilderFactory,
    MigrationColumnBuilder,
    MigrationTableBuilder,
    MigrationTableCallback,
} from './migration-builder-contract';
export type { MigrationBuilderOptions, MigrationCheckConstraint, MigrationColumnDefinition, MigrationForeignKeyDefinition, MigrationIndexDefinition, MigrationIndexKeyPart, MigrationAlterColumnDefinition, MigrationSequenceDefinition, MigrationSqlOptions, MigrationStatement, MigrationDropIndexOptions, MigrationTableCopyColumn, MigrationTableForeignKey, MigrationTableRebuildDefinition, MigrationTableShape, MigrationCreateTableOptions } from './migration-builder-types';
export type { MutableMigrationColumnDefinition } from './migration-builder-types';
export { MigrationRunner } from './migration-runner';
export type { MigrationDiagnosticsHandler, MigrationHistoryOptions, MigrationOperationOptions, MigrationRunnerDiagnosticsOptions, MigrationUpdateOptions, MigrationUpdateResult } from './migration-runner';
export { MigrationSqlGenerator } from './migration-sql-generator';
export { selectMigrationRange } from './migration-range';
export type { MigrationRangeItem } from './migration-range';
export { renderScript } from './migration-script-renderer';
export type { MigrationScriptOptions } from './migration-sql-generator';
export { postgresMigrationDialect } from './migration-sql-dialect';
export type { MigrationIdentity, MigrationSqlDialect } from './migration-sql-dialect';
export { diffModelSnapshots } from './model-differ';
export type { ModelDiff, ModelDiffOperation, ModelDiffOptions, ModelDiffRenameHints } from './model-differ';
export type {
    AddColumnOperation,
    AlterColumnOperation,
    CreateIndexOperation,
    CreateTableOperation,
    DropColumnOperation,
    DropIndexOperation,
    DropTableOperation,
    RenameTableOperation,
} from './model-diff-table-operations';
export type {
    AddCheckConstraintOperation,
    AddForeignKeyOperation,
    AlterSequenceOperation,
    CreateJoinTableOperation,
    CreateSequenceOperation,
    DropCheckConstraintOperation,
    DropForeignKeyOperation,
    DropJoinTableOperation,
    DropSequenceOperation,
    RebuildTableOperation,
} from './model-diff-schema-operations';
export type { ForeignKeyOperation } from './model-diff-schema-operations';
export { scaffoldMigration, writeMigrationScaffold, readModelSnapshot, renderSnapshotSource, collectDestructiveWarnings, formatMigrationTimestamp } from './migration-scaffolder';
export type { MigrationScaffoldOptions, MigrationScaffoldResult } from './migration-scaffolder';
export type { ModelSnapshotSource } from './model-snapshot-source';
export { discoverMigrations, loadMigrationFile } from './migration-discovery';
export type { DiscoveredMigration, MigrationDiscoveryResult } from './migration-discovery';
export { addMigration, removeLatestMigration, listMigrations, hasPendingModelChanges } from './migration-commands';
export type { MigrationAddResult, MigrationRemoveResult, PendingModelChangesResult } from './migration-commands';
export { migrationChecksum } from './migration-history';
export type { MigrationHistoryRow } from './migration-history';
export type {
    AlternateKeySnapshot,
    AuditSnapshot,
    CheckConstraintSnapshot,
    EntitySnapshot,
    IndexSnapshot,
    IndexKeyPartSnapshot,
    ManyToManySnapshot,
    ModelSnapshot,
    PropertySnapshot,
    RelationshipSnapshot,
    SequenceSnapshot,
    SoftDeleteSnapshot,
} from '../model/model-snapshot-types';
export type {
    IdentityColumnOptions,
    IdentityGenerationMode,
    RowIdColumnOptions,
    StoreGenerationStrategy,
} from '../model/store-generation';
export {
    MigrationChecksumError,
    MigrationDataLossError,
    MigrationError,
    MigrationExecutionError,
    MigrationLockReleaseError,
    PendingModelChangesError,
} from '../errors/migration-errors';
export { EntityKitError } from '../errors/entity-kit-error';
export type {
    MigrationErrorOptions,
    MigrationExecutionErrorOptions,
} from '../errors/migration-errors';
export type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    QueryStreamOptions,
    TransactionIsolationLevel,
    TransactionOptions,
} from '../storage/database-connection';
export type { MigrationDiagnosticEvent } from '../diagnostics/runtime/events';
export type {
    AlterColumnChange,
    SchemaSqlDialect,
    SqlDialect,
    SqlSequenceDefinition,
} from '../sql/sql-dialect';
export type { SqlStatement } from '../sql/sql-statement';
export type {
    EntityKitErrorCode,
    EntityKitErrorJson,
    EntityKitErrorOptions,
} from '../errors/entity-kit-error';

// History-table vocabulary. A provider dialect has to name the same table, take
// the same advisory lock, and stamp the same version as the runner, so these
// constants are part of the migration contract rather than runner internals.
export {
    entityKitMigrationVersion,
    migrationHistoryTableName,
    migrationLockKey,
} from './migration-metadata';
// Update planning and identifier casing, shared with the CLI's plan rendering
// and migration scaffolding.
export { createMigrationUpdatePlan } from './runner/migration-update-plan';
export type { MigrationUpdatePlan } from './runner/migration-update-plan';
export { toPascalIdentifier } from './migration-scaffold-timestamp';
