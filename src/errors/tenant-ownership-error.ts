import { EntityKitError } from './entity-kit-error';

export type TenantOwnershipFailure =
    | 'scope-mismatch'
    | 'tenant-key-change'
    | 'upsert-conflict';

/** Typed failure for a tracked entity crossing its persisted tenant boundary. */
export class TenantOwnershipError extends EntityKitError {
    constructor(
        entityName: string,
        tenantProperty: string,
        reason: TenantOwnershipFailure,
    ) {
        super(
            message(entityName, tenantProperty, reason),
            {
                code: 'TENANT_OWNERSHIP_VIOLATION',
                details: { entityName, reason, tenantProperty },
            },
        );
    }
}

function message(
    entityName: string,
    tenantProperty: string,
    reason: TenantOwnershipFailure,
): string {
    if (reason === 'tenant-key-change') {
        return `Tenant key '${entityName}.${tenantProperty}' cannot be changed on an existing tracked entity in a tenant-scoped context.`;
    }
    if (reason === 'upsert-conflict') {
        return `Upsert on '${entityName}' conflicted with a row outside the current tenant scope.`;
    }
    return `Tracked entity '${entityName}' does not belong to the current tenant scope. Use a cross-tenant context for tracked cross-tenant work.`;
}
