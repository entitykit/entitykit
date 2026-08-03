import type { DiagnosticsOptions, RuntimeDiagnosticsHandler } from '../../diagnostics/runtime/events';
import type { SaveChangesInterceptor } from '../../interceptors/save-changes-interceptor';
import type { DatabaseConnection } from '../../storage/database-connection';
import type { DatabaseDataSource } from '../../storage/database-data-source';
import type { MySqlConnectionConfig, PostgresConnectionConfig, SqliteConnectionConfig } from '../../storage/built-in-provider-config';
import type { DatabaseProviderConnectionConfig, DatabaseRuntimeProviderServices } from '../../storage/database-provider-services';
import { loadBuiltInMysqlProviderServices } from '../built-in-mysql';
import { loadBuiltInPostgresProviderServices } from '../built-in-postgres';
import { loadBuiltInSqliteProviderServices } from '../built-in-sqlite';
import type { OutboxOptions } from '../outbox-options';
import type {
    AuditOptions, DbContextOptions, LazyLoadingOptions,
    TenantScopeOptions, UseConnectionOptions,
} from './db-context-option-types';
import { assertConnectionString, ProviderSelection } from './provider-selection';
import { registerConnection } from './connection-registration';
import { createContextOptions } from './context-options-factory';
import { createRuntimeDiagnosticsHandler, validateLazyLoadingOptions } from './context-option-validation';

const tenantScopedBuilders: WeakSet<DbContextOptionsBuilder> = new WeakSet();
export class DbContextOptionsBuilder {
    private readonly providerSelection = new ProviderSelection();
    private readonly saveInterceptors: SaveChangesInterceptor[] = [];
    private readonly diagnostics: RuntimeDiagnosticsHandler[] = [];
    private auditing?: AuditOptions;
    private tenantScope?: TenantScopeOptions;
    private lazyLoading?: LazyLoadingOptions;
    private outbox?: OutboxOptions;

    public usePostgres(config: string | PostgresConnectionConfig): this {
        assertConnectionString('Postgres', config);
        return this.useProvider(loadBuiltInPostgresProviderServices(), config);
    }

    public useSqlite(config: string | SqliteConnectionConfig): this {
        assertConnectionString('SQLite', config);
        return this.useProvider(loadBuiltInSqliteProviderServices(), config);
    }

    public useMySql(config: string | MySqlConnectionConfig): this {
        assertConnectionString('MySQL', config);
        return this.useProvider(loadBuiltInMysqlProviderServices(), config);
    }

    public useProvider<TConfig extends object>(
        provider: DatabaseRuntimeProviderServices<TConfig>,
        config: DatabaseProviderConnectionConfig<TConfig>,
    ): this {
        this.providerSelection.useProvider(provider, config);
        return this;
    }

    public useDataSource(dataSource: DatabaseDataSource): this {
        this.providerSelection.useDataSource(dataSource);
        return this;
    }

    public useConnection(
        connection: DatabaseConnection,
        options: UseConnectionOptions = {},
    ): this {
        registerConnection(this.providerSelection, connection, options);
        return this;
    }

    public useSaveInterceptor(interceptor: SaveChangesInterceptor): this {
        this.saveInterceptors.push(interceptor);
        return this;
    }

    public useDiagnostics(
        handler: RuntimeDiagnosticsHandler,
        options: DiagnosticsOptions = {},
    ): this {
        this.diagnostics.push(createRuntimeDiagnosticsHandler(handler, options));
        return this;
    }

    public useAuditing(options: AuditOptions = {}): this {
        this.auditing = options;
        return this;
    }

    public useLazyLoading(options: LazyLoadingOptions = {}): this {
        validateLazyLoadingOptions(options);
        this.lazyLoading = { ...options };
        return this;
    }

    public useTenantScope(currentTenantId: () => unknown): this {
        if (typeof currentTenantId !== 'function') {
            throw new Error('useTenantScope requires a current-tenant callback.');
        }
        this.tenantScope = { currentTenantId, allowCrossTenantAccess: false };
        tenantScopedBuilders.add(this);
        return this;
    }

    public allowCrossTenantAccess(): this {
        this.tenantScope = {
            currentTenantId: () => undefined,
            allowCrossTenantAccess: true,
        };
        tenantScopedBuilders.add(this);
        return this;
    }

    public useOutbox(options: OutboxOptions): this {
        this.outbox = options;
        return this;
    }

    public build(): DbContextOptions {
        return createContextOptions(this.providerSelection.build(), {
            saveInterceptors: this.saveInterceptors,
            diagnostics: this.diagnostics,
            auditing: this.auditing,
            tenantScope: this.tenantScope,
            lazyLoading: this.lazyLoading,
            outbox: this.outbox,
        });
    }
}
export function hasConfiguredTenantScope(builder: DbContextOptionsBuilder): boolean {
    return tenantScopedBuilders.has(builder);
}
