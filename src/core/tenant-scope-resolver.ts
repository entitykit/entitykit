import { TenantScopeUnavailableError } from '../errors/tenant-scope-unavailable-error';

/** Resolve one stable tenant identity lazily for an operation. */
export function createTenantScopeResolver(
    currentTenantId: () => unknown,
): (entityName: string) => unknown {
    let tenantId: unknown;
    let resolved = false;
    return entityName => {
        if (!resolved) {
            tenantId = currentTenantId();
            resolved = true;
        }
        if (tenantId === undefined || tenantId === null) {
            throw new TenantScopeUnavailableError(entityName);
        }
        return tenantId;
    };
}
