import type {
    RuntimeDiagnosticsHandler,
} from '../../diagnostics/runtime/events';
import type { SaveChangesInterceptor } from '../../interceptors/save-changes-interceptor';
import type { MigrationBuilderFactory } from '../../migrations/migration-builder-contract';
import type { MigrationSqlDialect } from '../../migrations/migration-sql-dialect';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { DatabaseConnection } from '../../storage/database-connection';
import type { StoreValueReader } from '../../storage/store-value-reader';
import type { OutboxOptions } from '../outbox-options';

export type DatabaseProvider = string;

/** Provider identity recorded on a configured context. */
export interface ProviderOptions {
    readonly provider: string;
}

/** Options that configure audit. */ export interface AuditOptions {
    /** The now. */ readonly now?: () => Date;
    /** The current user id. */ readonly currentUserId?: () => unknown;
}

/** Options that configure tenant scope. */ export interface TenantScopeOptions {
    /** The current tenant id. */ readonly currentTenantId: () => unknown;
    /** Whether this context deliberately spans every tenant. */
    readonly allowCrossTenantAccess?: boolean;
}

/** Options that configure lazy loading. */ export interface LazyLoadingOptions {
    /** The max per context. */ readonly maxPerContext?: number;
}

export type ConnectionOwnership = 'context' | 'external';

export interface UseConnectionOptions {
    readonly provider?: string;
    readonly dialect?: SqlDialect;
    readonly migrationDialect?: MigrationSqlDialect;
    readonly createMigrationBuilder?: MigrationBuilderFactory;
    readonly valueReader?: StoreValueReader;
    readonly ownership?: ConnectionOwnership;
}

export interface DbContextOptions {
    readonly provider: ProviderOptions;
    readonly dialect: SqlDialect;
    readonly migrationDialect: MigrationSqlDialect;
    readonly createMigrationBuilder: MigrationBuilderFactory;
    readonly connection: DatabaseConnection;
    readonly ownsConnection: boolean;
    readonly valueReader?: StoreValueReader;
    readonly saveInterceptors: readonly SaveChangesInterceptor[];
    readonly diagnostics: readonly RuntimeDiagnosticsHandler[];
    readonly auditing?: AuditOptions;
    readonly tenantScope?: TenantScopeOptions;
    readonly lazyLoading?: LazyLoadingOptions;
    readonly outbox?: OutboxOptions;
}
