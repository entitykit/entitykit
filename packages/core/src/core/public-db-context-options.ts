import type { DiagnosticsOptions, RuntimeDiagnosticsHandler } from '../diagnostics/runtime/events';
import type { SaveChangesInterceptor } from '../interceptors/save-changes-interceptor';
import type {
    MySqlConnectionConfig,
    PostgresConnectionConfig,
    SqliteConnectionConfig,
} from '../storage/built-in-provider-config';
import type { DatabaseConnection } from '../storage/database-connection';
import type { DatabaseDataSource } from '../storage/database-data-source';
import type {
    DatabaseProviderConnectionConfig,
    DatabaseRuntimeProviderServices,
} from '../storage/database-provider-services';
import type {
    AuditOptions,
    LazyLoadingOptions,
    TenantScopeOptions,
    UseConnectionOptions,
} from './context-options/db-context-option-types';
import type { OutboxOptions } from './outbox-options';

/** Application-facing context configuration. */
export interface DbContextOptionsBuilder {
    /** Use the built-in Postgres provider. */ usePostgres(config: string | PostgresConnectionConfig): this;
    /** Use the built-in SQLite provider. */ useSqlite(config: string | SqliteConnectionConfig): this;
    /** Use the built-in MySQL provider. */ useMySql(config: string | MySqlConnectionConfig): this;
    /** Register a save lifecycle interceptor. */ useSaveInterceptor(interceptor: SaveChangesInterceptor): this;
    /** Subscribe to redacted runtime diagnostics. */ useDiagnostics(handler: RuntimeDiagnosticsHandler, options?: DiagnosticsOptions): this;
    /** Populate configured audit properties during saves. */ useAuditing(options?: AuditOptions): this;
    /** Enable explicit `lazy(...)` navigation wrappers; plain property access stays inert. */ useLazyLoading(options?: LazyLoadingOptions): this;
    /** Scope query and write operations to the current tenant. */ useTenantScope(currentTenantId: () => unknown): this;
    /** Deliberately configure a context whose operations span every tenant. */ allowCrossTenantAccess(): this;
    /** Persist configured outbox messages in the save transaction. */ useOutbox(options: OutboxOptions): this;
    /** Advanced provider registration; prefer the typed contracts from `@entitykit/core/adapter`. */
    useProvider<TConfig extends object>(
        provider: DatabaseRuntimeProviderServices<TConfig>,
        config: DatabaseProviderConnectionConfig<TConfig>,
    ): this;
    /** Reuse provider resources owned by an application-scoped data source. */
    useDataSource(dataSource: DatabaseDataSource): this;
    /** Use one provider-neutral connection, optionally transferring ownership. */
    useConnection(
        connection: DatabaseConnection,
        options?: UseConnectionOptions,
    ): this;
}

export type { AuditOptions, LazyLoadingOptions, TenantScopeOptions };
export type { OutboxMessage, OutboxOptions } from './outbox-options';
