import type { EntityPropertyKey } from '../../types';
import type { PropertyPathSelector } from '../model-property-selector';
import { EntityKeyConfiguration } from './key-configuration';

export class EntitySaasConfiguration<TEntity extends object>
    extends EntityKeyConfiguration<TEntity> {
    public audit(config: {
        createdAt?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
        updatedAt?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
        createdBy?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
        updatedBy?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
    }): this {
        this.saasFacet.audit(config);
        return this;
    }

    public softDelete(
        propertyName: EntityPropertyKey<TEntity>,
        deletedValue?: unknown
    ): this;
    public softDelete<TProperty>(
        selector: PropertyPathSelector<TEntity, TProperty>,
        deletedValue?: unknown
    ): this;
    public softDelete<TProperty>(
        propertyOrSelector:
      | EntityPropertyKey<TEntity>
      | PropertyPathSelector<TEntity, TProperty>,
        deletedValue?: unknown,
    ): this {
        this.saasFacet.softDelete(propertyOrSelector, deletedValue);
        return this;
    }

    public tenantKey(propertyName: EntityPropertyKey<TEntity>): this;
    public tenantKey<TProperty>(
        selector: PropertyPathSelector<TEntity, TProperty>
    ): this;
    public tenantKey<TProperty>(
        propertyOrSelector:
      | EntityPropertyKey<TEntity>
      | PropertyPathSelector<TEntity, TProperty>,
    ): this {
        this.saasFacet.tenantKey(propertyOrSelector);
        return this;
    }
}
