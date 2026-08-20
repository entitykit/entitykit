/**
 * Stands in for the future `@entitykit/core` package.
 *
 * Each group below is labelled with the public entry that serves it once the
 * packages exist, so the eventual specifier rewrite is a lookup rather than a
 * judgement call. The deep `src/...` paths are the stand-in for those entries
 * while everything still lives in one package.
 *
 * What is deliberately NOT here: any concrete database adapter (each is its own
 * package, see the future adapter-package fixture) and the recording test
 * doubles (their own package, see `future-testing-package.ts`).
 */

// --- core main entry: '.' ---
export { DbContext } from '../../../packages/core/src/core/db-context';
export type { SavePlanEntry } from '../../../packages/core/src/core/db-context';
export { DbContextOptionsBuilder } from '../../../packages/core/src/core/db-context-options';
export type {
    AuditOptions,
    DatabaseProvider,
    DbContextOptions,
    OutboxMessage,
    OutboxOptions,
    ProviderOptions,
    TenantScopeOptions,
} from '../../../packages/core/src/core/db-context-options';
export { DbSet } from '../../../packages/core/src/core/db-set';
export { DbUpdateConcurrencyError } from '../../../packages/core/src/core/db-update-concurrency-error';
export { ModelBuilder } from '../../../packages/core/src/model/model-builder';
export type { RuntimeDiagnosticEvent } from '../../../packages/core/src/diagnostics/runtime-diagnostics';

// --- core migrations entry: './migrations' ---
export { Migration } from '../../../packages/core/src/migrations/migration';
export { MigrationBuilder, MigrationColumnBuilder, MigrationTableBuilder } from '../../../packages/core/src/migrations/migration-builder';
export type {
    MigrationAlterColumnDefinition,
    MigrationColumnDefinition,
    MigrationForeignKeyDefinition,
    MigrationIndexDefinition,
    MigrationSqlOptions,
} from '../../../packages/core/src/migrations/migration-builder';
export type {
    MigrationBuilderFactory,
    MigrationTableCallback,
} from '../../../packages/core/src/migrations/migration-builder-contract';
export { MigrationRunner } from '../../../packages/core/src/migrations/migration-runner';
export type { MigrationRunnerDiagnosticsOptions, MigrationUpdateOptions, MigrationUpdateResult } from '../../../packages/core/src/migrations/migration-runner';
export type { MigrationSqlDialect } from '../../../packages/core/src/migrations/migration-sql-dialect';

// --- core adapter entry: './adapter' ---
// The contracts a provider package implements. Everything a built-in provider
// reaches for — the cancellation, transaction, and streaming primitives, the
// data-source factory, the provider-services validator — is reachable here too.
export type { DatabaseConnection, DatabaseQueryResult } from '../../../packages/core/src/storage/database-connection';
export type {
    DatabaseProviderConnectionConfig,
    DatabaseProviderServices,
    DatabaseSchemaIntrospector,
} from '../../../packages/core/src/storage/database-provider-services';
export type { DatabaseSchemaSnapshot } from '../../../packages/core/src/introspection/database-schema';
export type { SqlDialect } from '../../../packages/core/src/sql/sql-dialect';
export type { SqlStatement } from '../../../packages/core/src/sql/sql-statement';
