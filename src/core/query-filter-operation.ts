import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { boundQueryValue } from '../query/expression/bound-query-value';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
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
    const providerValuesByConverter: WeakMap<
        object,
        Map<string, unknown>
    > = new WeakMap();
    const resolveBoundTenant: QueryTenantProviderResolver = <TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
    ): unknown => {
        const propertyName = metadata.tenantKeyProperty;
        if (!propertyName) return undefined;
        const property = metadata.getProperty(propertyName);
        const converter = property.converter;
        const columnType = property.columnType.trim().toLowerCase();
        let providerValue: unknown;
        if (converter) {
            const cached = providerValuesByConverter.get(converter);
            if (cached?.has(columnType)) {
                providerValue = cached.get(columnType);
            } else {
                providerValue = toBoundPropertyValue(
                    resolveTenantId(metadata.entityName),
                    property,
                    metadata.entityName,
                );
                const values = cached ?? new Map<string, unknown>();
                values.set(columnType, providerValue);
                providerValuesByConverter.set(converter, values);
            }
        } else {
            providerValue = toBoundPropertyValue(
                resolveTenantId(metadata.entityName),
                property,
                metadata.entityName,
            );
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
