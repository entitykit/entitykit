import type { EntityPropertyKey } from '../types';
import type { AlternateKeyMetadata } from './alternate-key-metadata';
import type { EntityBuilderSaas } from './entity-builder-saas';
import { validateEntityPropertyRoles } from './entity-property-role-validation';
import type { PropertyMetadata } from './property-metadata';
import type { AuditMetadata, SoftDeleteMetadata } from './saas-metadata';

interface FinalizedEntitySaas<TEntity extends object> {
    readonly audit?: AuditMetadata<TEntity>;
    readonly softDelete?: SoftDeleteMetadata<TEntity>;
    readonly tenantKeyProperty?: EntityPropertyKey<TEntity>;
}

export function finalizeEntitySaas<TEntity extends object>(
    entityName: string,
    facet: EntityBuilderSaas<TEntity>,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
    alternateKeys: ReadonlyArray<AlternateKeyMetadata<TEntity>>,
): FinalizedEntitySaas<TEntity> {
    const audit = facet.finalizeAudit(properties);
    const softDelete = facet.finalizeSoftDelete(properties);
    const tenantKeyProperty = facet.finalizeTenantKey(properties);
    validateEntityPropertyRoles({
        entityName,
        properties,
        alternateKeys,
        audit,
        softDelete,
        tenantKeyProperty,
    });
    return { audit, softDelete, tenantKeyProperty };
}
