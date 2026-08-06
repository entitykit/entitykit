import { EntityKitError } from './entity-kit-error';

/** A primary key is not unique across tenants in a cross-tenant context. */
export class TenantIdentityAmbiguityError extends EntityKitError {
    constructor(entityName: string, tenantProperty: string) {
        super(
            `find() is ambiguous for tenant-keyed entity '${entityName}' in a cross-tenant context because '${tenantProperty}' is not part of its primary key. Query with an explicit tenant predicate instead.`,
            {
                code: 'TENANT_IDENTITY_AMBIGUOUS',
                details: { entityName, tenantProperty },
            },
        );
    }
}
