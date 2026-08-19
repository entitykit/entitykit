import type { EntityConstructor, EntityPropertyKey } from '../types';
import type { PropertyPathSelector } from './model-property-selector';
import type { PropertyMetadata } from './property-metadata';
import type { AuditMetadata, MutableAuditMetadata, MutableSoftDeleteMetadata, SoftDeleteMetadata } from './saas-metadata';
import type { EntityBuilderProperties } from './entity-builder-properties';
import { assertTenantKeyNotStoreGenerated } from './generated-tenant-key-validation';
import { finalizeSoftDeleteMetadata } from './soft-delete-metadata-validation';

/**
 * SaaS-metadata facet: audit columns, soft-delete marker, and tenant key.
 *
 * WHY separate: these three are cross-cutting persistence concerns layered on
 * top of ordinary properties — populated during `saveChanges()`, or consulted
 * by the implicit soft-delete / tenant query filters. Each names properties it
 * resolves and registers through the injected property registry, then validates
 * them at finalize time (including the rule that a soft-delete marker must be
 * nullable). Grouping the multi-tenant and audit rules keeps them in one place
 * rather than scattered through the fluent entry point.
 */
export class EntityBuilderSaas<TEntity extends object> {
    private auditMetadata?: MutableAuditMetadata<TEntity>;
    private softDeleteMetadata?: MutableSoftDeleteMetadata<TEntity>;
    private tenantKeyProperty?: EntityPropertyKey<TEntity>;

    constructor(
        private readonly ctor: EntityConstructor<TEntity>,
        private readonly properties: EntityBuilderProperties<TEntity>,
    ) {}

    public audit(config: {
        createdAt?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
        updatedAt?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
        createdBy?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
        updatedBy?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
    }): void {
        const audit: MutableAuditMetadata<TEntity> = {};

        if (config.createdAt) {
            audit.createdAtProperty = this.properties.resolvePropertyName(config.createdAt);
            this.configurePolicyProperty(audit.createdAtProperty);
        }

        if (config.updatedAt) {
            audit.updatedAtProperty = this.properties.resolvePropertyName(config.updatedAt);
            this.configurePolicyProperty(audit.updatedAtProperty);
        }

        if (config.createdBy) {
            audit.createdByProperty = this.properties.resolvePropertyName(config.createdBy);
            this.configurePolicyProperty(audit.createdByProperty);
        }

        if (config.updatedBy) {
            audit.updatedByProperty = this.properties.resolvePropertyName(config.updatedBy);
            this.configurePolicyProperty(audit.updatedByProperty);
        }

        this.auditMetadata = audit;
    }

    public softDelete<TProperty>(propertyOrSelector: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity, TProperty>, deletedValue?: unknown): void {
        const propertyName = this.properties.resolvePropertyName(propertyOrSelector);
        this.configurePolicyProperty(propertyName);
        this.softDeleteMetadata = {
            propertyName,
            deletedValue,
            usesTimestampConvention:
                deletedValue === undefined &&
                typeof propertyOrSelector === 'function',
        };
    }

    public tenantKey<TProperty>(propertyOrSelector: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity, TProperty>): void {
        const propertyName = this.properties.resolvePropertyName(propertyOrSelector);
        this.configurePolicyProperty(propertyName);
        this.tenantKeyProperty = propertyName;
    }

    public finalizeAudit(properties: ReadonlyArray<PropertyMetadata<TEntity>>): AuditMetadata<TEntity> | undefined {
        if (!this.auditMetadata) {
            return undefined;
        }

        const propertyNames = new Set(properties.map(property => property.propertyName));
        const configuredProperties: readonly unknown[] = [
            this.auditMetadata.createdAtProperty,
            this.auditMetadata.updatedAtProperty,
            this.auditMetadata.createdByProperty,
            this.auditMetadata.updatedByProperty,
        ];
        for (const configuredProperty of configuredProperties) {
            if (configuredProperty === undefined) {
                continue;
            }
            const propertyName = configuredProperty as EntityPropertyKey<TEntity>;
            if (!propertyNames.has(propertyName)) {
                throw new Error(`Audit configuration on entity '${this.ctor.name}' references unconfigured property '${propertyName}'.`);
            }
        }

        return { ...this.auditMetadata };
    }

    public finalizeSoftDelete(properties: ReadonlyArray<PropertyMetadata<TEntity>>): SoftDeleteMetadata<TEntity> | undefined {
        return finalizeSoftDeleteMetadata(
            this.ctor.name,
            this.softDeleteMetadata,
            properties,
        );
    }

    public finalizeTenantKey(properties: ReadonlyArray<PropertyMetadata<TEntity>>): EntityPropertyKey<TEntity> | undefined {
        if (!this.tenantKeyProperty) {
            return undefined;
        }

        const propertyNames = new Set(properties.map(property => property.propertyName));
        if (!propertyNames.has(this.tenantKeyProperty)) {
            throw new Error(`Tenant key configuration on entity '${this.ctor.name}' references unconfigured property '${this.tenantKeyProperty}'.`);
        }
        assertTenantKeyNotStoreGenerated(
            this.ctor.name,
            this.tenantKeyProperty,
            properties,
        );

        return this.tenantKeyProperty;
    }

    private configurePolicyProperty(propertyName: EntityPropertyKey<TEntity>): void {
        this.properties.assertNotIgnored(propertyName);
        if (!propertyName.includes('.')) {
            this.properties.ensureProperty(propertyName);
        }
    }
}
