import { EntityKitError } from './entity-kit-error';

export type TenantOwnershipFailure = 'scope-mismatch' | 'tenant-key-change';

/** Typed failure for a tracked entity crossing its persisted tenant boundary. */
export class TenantOwnershipError extends EntityKitError {
    constructor(
        entityName: string,
        tenantProperty: string,
        reason: TenantOwnershipFailure,
    ) {
        super(
            reason === 'tenant-key-change'
                ? `Tenant key '${entityName}.${tenantProperty}' cannot be changed on an existing tracked entity in a tenant-scoped context.`
                : `Tracked entity '${entityName}' does not belong to the current tenant scope. Use a cross-tenant context for tracked cross-tenant work.`,
            {
                code: 'TENANT_OWNERSHIP_VIOLATION',
                details: { entityName, reason, tenantProperty },
            },
        );
    }
}
