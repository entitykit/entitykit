import type { EntityPropertyKey } from '../../types';
import type { PropertySelector } from '../model-property-selector';
import type { PropertyBuilder } from '../property-builder-types';
import { EntityBuilderBase } from './entity-builder-base';
import type {
    ComplexPropertyBuilder,
    ComplexPropertyOptions,
} from '../complex-property-builder-types';

export class EntityPropertyConfiguration<TEntity extends object>
    extends EntityBuilderBase<TEntity> {
    public complexProperty<
        TComplex extends object | null | undefined,
    >(
        selector: PropertySelector<TEntity, TComplex>,
        configure?: (
            complex: ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>;
    public complexProperty<
        TComplex extends object | null | undefined,
    >(
        selector: PropertySelector<TEntity, TComplex>,
        options: ComplexPropertyOptions<NonNullable<TComplex>>,
        configure?: (
            complex: ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>;
    public complexProperty<
        TComplex extends object | null | undefined,
    >(
        selector: PropertySelector<TEntity, TComplex>,
        optionsOrConfigure?:
            | ComplexPropertyOptions<NonNullable<TComplex>>
            | ((
                complex:
                ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>,
            ) => void),
        configure?: (
            complex: ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TComplex>> {
        const options = typeof optionsOrConfigure === 'function'
            ? undefined
            : optionsOrConfigure;
        const callback = typeof optionsOrConfigure === 'function'
            ? optionsOrConfigure
            : configure;
        const builder = this.complexPropertiesFacet.complexProperty(
            selector,
            options,
        );
        callback?.(builder);
        return builder;
    }

    public property<TProperty = TEntity[EntityPropertyKey<TEntity>]>(
        propertyOrSelector:
      | EntityPropertyKey<TEntity>
      | PropertySelector<TEntity, TProperty>,
    ): PropertyBuilder<TProperty> {
        return this.propertiesFacet.property<TProperty>(propertyOrSelector);
    }

    public ignore(propertyName: EntityPropertyKey<TEntity>): this;
    public ignore<TProperty>(selector: PropertySelector<TEntity, TProperty>): this;
    public ignore(
        propertyOrSelector:
      | EntityPropertyKey<TEntity>
      | PropertySelector<TEntity>,
    ): this {
        this.propertiesFacet.ignore(propertyOrSelector);
        return this;
    }
}
