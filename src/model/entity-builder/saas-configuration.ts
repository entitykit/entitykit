import type { EntityPropertyKey } from '../../types';
import type { PropertySelector } from '../model-property-selector';
import { EntityKeyConfiguration } from './key-configuration';

export class EntitySaasConfiguration<TEntity extends object>
    extends EntityKeyConfiguration<TEntity> {
    public audit(config: {
        createdAt?: EntityPropertyKey<TEntity> | PropertySelector<TEntity>;
        updatedAt?: EntityPropertyKey<TEntity> | PropertySelector<TEntity>;
        createdBy?: EntityPropertyKey<TEntity> | PropertySelector<TEntity>;
        updatedBy?: EntityPropertyKey<TEntity> | PropertySelector<TEntity>;
    }): this {
        this.saasFacet.audit(config);
        return this;
    }

    public softDelete(
        propertyName: EntityPropertyKey<TEntity>,
        deletedValue?: unknown
    ): this;
    public softDelete<TProperty>(
        selector: PropertySelector<TEntity, TProperty>,
        deletedValue?: unknown
    ): this;
    public softDelete<TProperty>(
        propertyOrSelector:
      | EntityPropertyKey<TEntity>
      | PropertySelector<TEntity, TProperty>,
        deletedValue?: unknown,
    ): this {
        this.saasFacet.softDelete(propertyOrSelector, deletedValue);
        return this;
    }

    public tenantKey(propertyName: EntityPropertyKey<TEntity>): this;
    public tenantKey<TProperty>(
        selector: PropertySelector<TEntity, TProperty>
    ): this;
    public tenantKey<TProperty>(
        propertyOrSelector:
      | EntityPropertyKey<TEntity>
      | PropertySelector<TEntity, TProperty>,
    ): this {
        this.saasFacet.tenantKey(propertyOrSelector);
        return this;
    }
}
