import { EntityKitError } from './entity-kit-error';

/** Typed error reported when a tenant-scoped operation has no tenant identity. */
export class TenantScopeUnavailableError extends EntityKitError {
    constructor(entityName: string) {
        super(
            `Tenant scope is unavailable for entity '${entityName}'. Provide a current tenant, explicitly ignore tenant scope for this query, or configure a cross-tenant context.`,
            {
                code: 'TENANT_SCOPE_UNAVAILABLE',
                details: { entityName },
            },
        );
    }
}
