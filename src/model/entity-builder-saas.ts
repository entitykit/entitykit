import type { EntityConstructor, EntityPropertyKey } from '../types';
import type { PropertySelector } from './model-property-selector';
import type { PropertyMetadata } from './property-metadata';
import type { AuditMetadata, MutableAuditMetadata, MutableSoftDeleteMetadata, SoftDeleteMetadata } from './saas-metadata';
import type { EntityBuilderProperties } from './entity-builder-properties';

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
        createdAt?: EntityPropertyKey<TEntity> | PropertySelector<TEntity>;
        updatedAt?: EntityPropertyKey<TEntity> | PropertySelector<TEntity>;
        createdBy?: EntityPropertyKey<TEntity> | PropertySelector<TEntity>;
        updatedBy?: EntityPropertyKey<TEntity> | PropertySelector<TEntity>;
    }): void {
        const audit: MutableAuditMetadata<TEntity> = {};

        if (config.createdAt) {
            audit.createdAtProperty = this.properties.resolvePropertyName(config.createdAt);
            this.properties.assertNotIgnored(audit.createdAtProperty);
            this.properties.ensureProperty(audit.createdAtProperty);
        }

        if (config.updatedAt) {
            audit.updatedAtProperty = this.properties.resolvePropertyName(config.updatedAt);
            this.properties.assertNotIgnored(audit.updatedAtProperty);
            this.properties.ensureProperty(audit.updatedAtProperty);
        }

        if (config.createdBy) {
            audit.createdByProperty = this.properties.resolvePropertyName(config.createdBy);
            this.properties.assertNotIgnored(audit.createdByProperty);
            this.properties.ensureProperty(audit.createdByProperty);
        }

        if (config.updatedBy) {
            audit.updatedByProperty = this.properties.resolvePropertyName(config.updatedBy);
            this.properties.assertNotIgnored(audit.updatedByProperty);
            this.properties.ensureProperty(audit.updatedByProperty);
        }

        this.auditMetadata = audit;
    }

    public softDelete<TProperty>(propertyOrSelector: EntityPropertyKey<TEntity> | PropertySelector<TEntity, TProperty>, deletedValue?: unknown): void {
        const propertyName = this.properties.resolvePropertyName(propertyOrSelector);
        this.properties.assertNotIgnored(propertyName);
        this.properties.ensureProperty(propertyName);
        this.softDeleteMetadata = { propertyName, deletedValue };
    }

    public tenantKey<TProperty>(propertyOrSelector: EntityPropertyKey<TEntity> | PropertySelector<TEntity, TProperty>): void {
        const propertyName = this.properties.resolvePropertyName(propertyOrSelector);
        this.properties.assertNotIgnored(propertyName);
        this.properties.ensureProperty(propertyName);
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
        if (!this.softDeleteMetadata?.propertyName) {
            return undefined;
        }

        const propertyName = this.softDeleteMetadata.propertyName;
        const property = properties.find(candidate => candidate.propertyName === propertyName);
        if (!property) {
            throw new Error(`Soft delete configuration on entity '${this.ctor.name}' references unconfigured property '${propertyName}'.`);
        }

        // A live row is one whose marker is null, so a required marker makes every
        // row permanently invisible: the generated column is `not null` and the
        // implicit filter is `is null`. Silent and total, so it is refused here.
        if (property.isRequired) {
            throw new Error(`Soft delete property '${propertyName}' on entity '${this.ctor.name}' must be nullable, because a live row is one whose marker is null.`);
        }

        return {
            propertyName: this.softDeleteMetadata.propertyName,
            deletedValue: this.softDeleteMetadata.deletedValue,
        };
    }

    public finalizeTenantKey(properties: ReadonlyArray<PropertyMetadata<TEntity>>): EntityPropertyKey<TEntity> | undefined {
        if (!this.tenantKeyProperty) {
            return undefined;
        }

        const propertyNames = new Set(properties.map(property => property.propertyName));
        if (!propertyNames.has(this.tenantKeyProperty)) {
            throw new Error(`Tenant key configuration on entity '${this.ctor.name}' references unconfigured property '${this.tenantKeyProperty}'.`);
        }

        return this.tenantKeyProperty;
    }
}
