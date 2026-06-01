import type { EntityConstructor } from '../types';
import {
    selectPropertyPath,
    type PropertySelector,
} from './model-property-selector';
import type {
    MutableComplexPropertyMetadata,
} from './complex-property-metadata';
import type { PropertyBuilder } from './property-builder-types';
import type {
    ComplexPropertyBuilder,
    ComplexPropertyOptions,
} from './complex-property-builder-types';

export interface ComplexPropertyRegistry<TEntity extends object> {
    propertyAtPath<TProperty>(
        path: readonly string[],
    ): PropertyBuilder<TProperty>;
    complexAtPath<TComplex extends object>(
        path: readonly string[],
        ctor?: EntityConstructor<TComplex>,
        required?: boolean,
    ): ComplexPropertyBuilder<TEntity, TComplex>;
}

class ComplexPropertyBuilderImplementation<
    TEntity extends object,
    TComplex extends object,
> implements ComplexPropertyBuilder<TEntity, TComplex> {
    constructor(
        private readonly properties: ComplexPropertyRegistry<TEntity>,
        private readonly metadata: MutableComplexPropertyMetadata,
    ) {}

    public property<TProperty>(
        selector: PropertySelector<TComplex, TProperty>,
    ): PropertyBuilder<TProperty> {
        const relativePath = directPath(selector, 'property');
        return this.properties.propertyAtPath<TProperty>([
            ...this.metadata.propertyPath,
            ...relativePath,
        ]);
    }

    public complexProperty<TNested extends object | null | undefined>(
        selector: PropertySelector<TComplex, TNested>,
        configure?: (
            nested: ComplexPropertyBuilder<TEntity, NonNullable<TNested>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TNested>>;
    public complexProperty<TNested extends object | null | undefined>(
        selector: PropertySelector<TComplex, TNested>,
        options: ComplexPropertyOptions<NonNullable<TNested>>,
        configure?: (
            nested: ComplexPropertyBuilder<TEntity, NonNullable<TNested>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TNested>>;
    public complexProperty<TNested extends object | null | undefined>(
        selector: PropertySelector<TComplex, TNested>,
        optionsOrConfigure?:
            | ComplexPropertyOptions<NonNullable<TNested>>
            | ((
                nested: ComplexPropertyBuilder<
                    TEntity,
                    NonNullable<TNested>
                >,
            ) => void),
        configure?: (
            nested: ComplexPropertyBuilder<TEntity, NonNullable<TNested>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TNested>> {
        const path = [
            ...this.metadata.propertyPath,
            ...directPath(selector, 'complexProperty'),
        ];
        const options = typeof optionsOrConfigure === 'function'
            ? undefined
            : optionsOrConfigure;
        const callback = typeof optionsOrConfigure === 'function'
            ? optionsOrConfigure
            : configure;
        const builder = this.properties.complexAtPath<NonNullable<TNested>>(
            path,
            configuredComplexConstructor(options),
            options?.required,
        );
        callback?.(builder);
        return builder;
    }

    public isRequired(): this {
        this.metadata.isRequired = true;
        return this;
    }

    public isOptional(): this {
        this.metadata.isRequired = false;
        return this;
    }

    public get propertyName(): string {
        return this.metadata.propertyName;
    }
}

export function createComplexPropertyBuilder<
    TEntity extends object,
    TComplex extends object,
>(
    properties: ComplexPropertyRegistry<TEntity>,
    metadata: MutableComplexPropertyMetadata,
): ComplexPropertyBuilder<TEntity, TComplex> {
    return new ComplexPropertyBuilderImplementation(properties, metadata);
}

export function configuredComplexConstructor<TComplex extends object>(
    options?: ComplexPropertyOptions<TComplex>,
): EntityConstructor<TComplex> | undefined {
    return options &&
        Object.prototype.hasOwnProperty.call(options, 'constructor')
        ? options.constructor
        : undefined;
}

function directPath<TEntity extends object, TProperty>(
    selector: PropertySelector<TEntity, TProperty>,
    operation: string,
): readonly string[] {
    const path = selectPropertyPath(selector);
    if (path.length !== 1) {
        throw new Error(
            `${operation}() must select one direct property; configure nested value objects with complexProperty().`,
        );
    }
    return path;
}
