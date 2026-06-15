import type { EntityConstructor } from '../types';
import {
    configuredComplexConstructor,
    createComplexPropertyBuilder,
    type ComplexPropertyRegistry,
} from './complex-property-builder';
import type {
    ComplexPropertyBuilder,
    ComplexPropertyOptions,
} from './complex-property-builder-types';
import type {
    ComplexPropertyMetadata,
    MutableComplexPropertyMetadata,
} from './complex-property-metadata';
import type { EntityBuilderProperties } from './entity-builder-properties';
import {
    selectPropertyPath,
    type PropertySelector,
} from './model-property-selector';
import type { PropertyBuilder } from './property-builder-types';

/** Registry and validation for flattened value-object paths. */
export class EntityBuilderComplexProperties<TEntity extends object>
implements ComplexPropertyRegistry<TEntity> {
    private readonly complexProperties:
    Map<string, MutableComplexPropertyMetadata> = new Map();

    constructor(
        private readonly ctor: EntityConstructor<TEntity>,
        private readonly properties: EntityBuilderProperties<TEntity>,
    ) {}

    public complexProperty<TComplex extends object | null | undefined>(
        selector: PropertySelector<TEntity, TComplex>,
        options?: ComplexPropertyOptions<NonNullable<TComplex>>,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TComplex>> {
        const path = selectPropertyPath(selector);
        if (path.length !== 1) {
            throw new Error(
                'Entity complexProperty() must select one direct property; configure nested value objects from their parent builder.',
            );
        }
        return this.complexAtPath(
            path,
            configuredComplexConstructor(options),
            options?.required,
        );
    }

    public propertyAtPath<TProperty>(
        path: readonly string[],
    ): PropertyBuilder<TProperty> {
        return this.properties.propertyAtPath<TProperty>(path);
    }

    public complexAtPath<TComplex extends object>(
        path: readonly string[],
        ctor?: EntityConstructor<TComplex>,
        required?: boolean,
    ): ComplexPropertyBuilder<TEntity, TComplex> {
        const propertyName = path.join('.');
        if (this.complexProperties.has(propertyName)) {
            throw new Error(
                `Complex property '${this.ctor.name}.${propertyName}' is already configured.`,
            );
        }
        this.properties.reserveComplexPath(path);
        const metadata: MutableComplexPropertyMetadata = {
            propertyName,
            propertyPath: [...path],
            ctor: ctor,
            isRequired: required ?? false,
        };
        this.complexProperties.set(propertyName, metadata);
        return createComplexPropertyBuilder<TEntity, TComplex>(
            this,
            metadata,
        );
    }

    public finalize(): readonly ComplexPropertyMetadata[] {
        const leaves = Array.from(this.properties.properties.keys());
        return [...this.complexProperties.values()]
            .sort((left, right) =>
                left.propertyPath.length - right.propertyPath.length)
            .map(item => {
                const prefix = `${item.propertyName}.`;
                if (!leaves.some(property => property.startsWith(prefix))) {
                    throw new Error(
                        `Complex property '${this.ctor.name}.${item.propertyName}' must configure at least one mapped property.`,
                    );
                }
                return {
                    propertyName: item.propertyName,
                    propertyPath: [...item.propertyPath],
                    isRequired: item.isRequired ?? false,
                    ctor: item.ctor,
                };
            });
    }
}
