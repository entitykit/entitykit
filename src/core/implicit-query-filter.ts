import type { EntityMetadata } from '../model/entity-metadata';
import { FieldExpression } from '../query/expression/field-expression';
import type { PredicateExpression } from '../query/expression/predicate-expression';

export interface ImplicitQueryFilterOptions {
    readonly softDelete: boolean;
    readonly tenant: boolean;
}

/** Build the implicit predicates for one source within a scoped operation. */
export function implicitQueryFilters<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    sourceAlias: string | undefined,
    applies: ImplicitQueryFilterOptions,
    resolveTenantId: (entityName: string) => unknown,
    allowsCrossTenantAccess: boolean,
): PredicateExpression[] {
    const filters: PredicateExpression[] = [];
    if (metadata.softDelete && applies.softDelete) {
        filters.push(new FieldExpression<TEntity, unknown>(
            metadata.softDelete.propertyName,
            sourceAlias,
        ).isNull());
    }
    if (metadata.tenantKeyProperty && applies.tenant && !allowsCrossTenantAccess) {
        filters.push(new FieldExpression<TEntity, unknown>(
            metadata.tenantKeyProperty,
            sourceAlias,
        ).eq(resolveTenantId(metadata.entityName)));
    }
    return filters;
}
