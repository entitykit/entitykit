import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { boundQueryValue } from '../query/expression/bound-query-value';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { createTenantScopeResolver } from './tenant-scope-resolver';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';

/** One immutable tenant/filter snapshot shared by every SQL read in a query. */
export interface QueryFilterOperation {
    readonly allowsCrossTenantAccess: boolean;

    tenantIdFor(entityName: string): unknown;

    apply<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ): QueryModel<TEntity>;
}

export type QueryTenantProviderResolver = <TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
) => unknown;

export function createQueryFilterOperation(
    currentTenantId: () => unknown,
    allowsCrossTenantAccess: boolean,
    apply: <TEntity extends object>(
        resolveTenantId: (entityName: string) => unknown,
        resolveBoundTenant: QueryTenantProviderResolver,
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ) => QueryModel<TEntity>,
): QueryFilterOperation {
    const resolveTenantId = createTenantScopeResolver(currentTenantId);
    const providerValuesByConverter: Map<
        object | undefined,
        Map<string, unknown>
    > = new Map();
    const resolveBoundTenant: QueryTenantProviderResolver = <TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
    ): unknown => {
        const propertyName = metadata.tenantKeyProperty;
        if (!propertyName) return undefined;
        const property = metadata.getProperty(propertyName);
        const converter = property.converter;
        const columnType = property.columnType.trim().toLowerCase();
        let providerValue: unknown;
        const cached = providerValuesByConverter.get(converter);
        if (cached?.has(columnType)) {
            providerValue = cached.get(columnType);
        } else {
            providerValue = cloneSnapshotValue(
                toBoundPropertyValue(
                    resolveTenantId(metadata.entityName),
                    property,
                    metadata.entityName,
                ),
            );
            const values = cached ?? new Map<string, unknown>();
            values.set(columnType, providerValue);
            providerValuesByConverter.set(converter, values);
        }
        return boundQueryValue(providerValue);
    };
    return {
        allowsCrossTenantAccess,
        tenantIdFor: entityName => allowsCrossTenantAccess
            ? undefined
            : resolveTenantId(entityName),
        apply: (metadata, query) => apply(
            resolveTenantId,
            resolveBoundTenant,
            metadata,
            query,
        ),
    };
}
