import type { RuntimeDiagnosticsEmitter } from '../../diagnostics/runtime/events';
import type { SaveChangesInterceptor } from '../../interceptors/save-changes-interceptor';
import type { OutboxOptions } from '../outbox-options';
import type {
    AuditOptions,
    DbContextOptions,
    LazyLoadingOptions,
    TenantScopeOptions,
} from './db-context-option-types';
import { wrapDiagnosticConnection } from './diagnostic-connection';
import type { ConfiguredProvider } from './provider-selection';

export interface ContextBehaviorOptions {
    readonly saveInterceptors: readonly SaveChangesInterceptor[];
    readonly diagnostics: readonly RuntimeDiagnosticsEmitter[];
    readonly auditing?: AuditOptions;
    readonly tenantScope?: TenantScopeOptions;
    readonly lazyLoading?: LazyLoadingOptions;
    readonly outbox?: OutboxOptions;
}

export function createContextOptions(
    configured: ConfiguredProvider,
    behavior: ContextBehaviorOptions,
): DbContextOptions {
    const provider = Object.freeze({ ...configured.provider });
    const connection = behavior.diagnostics.length === 0
        ? configured.connection
        : wrapDiagnosticConnection(
            configured.connection,
            provider.provider,
            behavior.diagnostics,
        );
    return Object.freeze({
        provider,
        dialect: configured.dialect,
        migrationDialect: configured.migrationDialect,
        createMigrationBuilder: configured.createMigrationBuilder,
        connection,
        ownsConnection: configured.ownsConnection,
        valueReader: configured.valueReader,
        saveInterceptors: Object.freeze([...behavior.saveInterceptors]),
        diagnostics: Object.freeze([...behavior.diagnostics]),
        auditing: behavior.auditing
            ? Object.freeze({ ...behavior.auditing })
            : undefined,
        tenantScope: behavior.tenantScope,
        lazyLoading: behavior.lazyLoading
            ? Object.freeze({ ...behavior.lazyLoading })
            : undefined,
        outbox: behavior.outbox,
    });
}
