import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { createTenantScopeResolver } from './tenant-scope-resolver';

/** One immutable tenant/filter snapshot shared by every SQL read in a query. */
export interface QueryFilterOperation {
    readonly allowsCrossTenantAccess: boolean;

    tenantIdFor(entityName: string): unknown;

    apply<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ): QueryModel<TEntity>;
}

export function createQueryFilterOperation(
    currentTenantId: () => unknown,
    allowsCrossTenantAccess: boolean,
    apply: <TEntity extends object>(
        resolveTenantId: (entityName: string) => unknown,
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ) => QueryModel<TEntity>,
): QueryFilterOperation {
    const resolveTenantId = createTenantScopeResolver(currentTenantId);
    return {
        allowsCrossTenantAccess,
        tenantIdFor: entityName => allowsCrossTenantAccess
            ? undefined
            : resolveTenantId(entityName),
        apply: (metadata, query) => apply(resolveTenantId, metadata, query),
    };
}
