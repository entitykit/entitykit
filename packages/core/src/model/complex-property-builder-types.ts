import type { EntityConstructor } from '../types';
import type { PropertySelector } from './model-property-selector';
import type { PropertyBuilder } from './property-builder-types';

/** Options that configure complex property. */ export interface ComplexPropertyOptions<TComplex extends object> {
    /** function Object() { [native code] } */ readonly constructor?: EntityConstructor<TComplex>;
    /** The required. */ readonly required?: boolean;
}

/** Configures a table-sharing nested value object and its flattened columns. */
export interface ComplexPropertyBuilder<
    TEntity extends object,
    TComplex extends object,
> {
    /** Perform the property operation. */ property<TProperty>(
        selector: PropertySelector<TComplex, TProperty>,
    ): PropertyBuilder<TProperty>;
    /** Perform the complex property operation. */ complexProperty<TNested extends object | null | undefined>(
        selector: PropertySelector<TComplex, TNested>,
        configure?: (
            nested: ComplexPropertyBuilder<TEntity, NonNullable<TNested>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TNested>>;
    /** Perform the complex property operation. */ complexProperty<TNested extends object | null | undefined>(
        selector: PropertySelector<TComplex, TNested>,
        options: ComplexPropertyOptions<NonNullable<TNested>>,
        configure?: (
            nested: ComplexPropertyBuilder<TEntity, NonNullable<TNested>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TNested>>;
    /** Configure required and return this builder. */ isRequired(): this;
    /** Configure optional and return this builder. */ isOptional(): this;
    /** The property name. */ readonly propertyName: string;
}
