import type { EntityConstructor, EntityPropertyKey } from '../types';
import { PropertyBuilderImplementation } from './property-builder';
import type { PropertyBuilder } from './property-builder-types';
import type { PropertySelector } from './model-property-selector';
import {
    selectPropertyName,
    selectPropertyPath,
} from './model-property-selector';
import type { MutablePropertyMetadata, PropertyMetadata } from './property-metadata';
import { finalizeProperty } from './property-metadata-finalizer';
import { ValueGenerated } from './value-generated';
import {
    validateDuplicateColumns,
} from './duplicate-column-validation';

/**
 * Property-configuration facet.
 *
 * WHY separate: this owns the entity's property registry — the map of mapped
 * columns and ignored members, plus name resolution, finalization, and guards
 * shared by the key, SaaS, and index facets.
 */
export class EntityBuilderProperties<TEntity extends object> {
    public readonly properties: Map<string, MutablePropertyMetadata<TEntity>> = new Map();
    public readonly ignoredProperties: Set<EntityPropertyKey<TEntity>> = new Set();
    private readonly complexPaths: Set<string> = new Set();
    constructor(private readonly ctor: EntityConstructor<TEntity>) {}
    public property<TProperty = TEntity[EntityPropertyKey<TEntity>]>(
        propertyOrSelector: EntityPropertyKey<TEntity> | PropertySelector<TEntity, TProperty>,
    ): PropertyBuilder<TProperty> {
        const path = typeof propertyOrSelector === 'function'
            ? selectPropertyPath(propertyOrSelector)
            : [propertyOrSelector];
        if (path.length !== 1 || path[0].includes('.')) {
            throw new Error(
                `Nested property '${path.join('.')}' on '${this.ctor.name}' must be configured through complexProperty().`,
            );
        }
        const propertyName = path[0];
        this.assertNotIgnored(propertyName);
        if (this.complexPaths.has(propertyName)) {
            throw new Error(
                `Property '${propertyName}' on '${this.ctor.name}' is configured as a complex property and cannot also map one column.`,
            );
        }
        return new PropertyBuilderImplementation<TEntity, TProperty>(
            this.ensureProperty(propertyName, path) as
            MutablePropertyMetadata<TEntity, TProperty>,
        );
    }
    public propertyAtPath<TProperty>(
        path: readonly string[],
    ): PropertyBuilder<TProperty> {
        const propertyName = path.join('.');
        if (this.complexPaths.has(propertyName)) {
            throw new Error(
                `Property '${propertyName}' on '${this.ctor.name}' is configured as a complex property and cannot also map one column.`,
            );
        }
        return new PropertyBuilderImplementation<TEntity, TProperty>(
            this.ensureProperty(propertyName, path) as
            MutablePropertyMetadata<TEntity, TProperty>,
        );
    }
    public reserveComplexPath(path: readonly string[]): void {
        const propertyName = path.join('.');
        this.assertNotIgnored(path[0]);
        if (this.properties.has(propertyName)) {
            throw new Error(
                `Property '${propertyName}' on '${this.ctor.name}' already maps a column and cannot also be complex.`,
            );
        }
        this.complexPaths.add(propertyName);
    }
    public concurrencyToken<TProperty>(propertyOrSelector: EntityPropertyKey<TEntity> | PropertySelector<TEntity, TProperty>): void {
        const propertyName = this.resolvePropertyName(propertyOrSelector);
        this.assertNotIgnored(propertyName);
        this.ensureProperty(propertyName).isConcurrencyToken = true;
    }

    public version<TProperty>(propertyOrSelector: EntityPropertyKey<TEntity> | PropertySelector<TEntity, TProperty>): void {
        const propertyName = this.resolvePropertyName(propertyOrSelector);
        this.assertNotIgnored(propertyName);
        const property = this.ensureProperty(propertyName);
        property.isConcurrencyToken = true;
        property.isVersion = true;
    }

    public ignore(propertyOrSelector: EntityPropertyKey<TEntity> | PropertySelector<TEntity>): void {
        const propertyName = this.resolvePropertyName(propertyOrSelector);
        if (
            this.properties.has(propertyName) ||
            this.complexPaths.has(propertyName)
        ) {
            throw new Error(`Property '${propertyName}' on entity '${this.ctor.name}' cannot be ignored because it is already configured.`);
        }
        this.ignoredProperties.add(propertyName);
    }

    public resolvePropertyName<TProperty>(
        propertyOrSelector: EntityPropertyKey<TEntity> | PropertySelector<TEntity, TProperty>,
    ): EntityPropertyKey<TEntity> {
        if (typeof propertyOrSelector === 'function') {
            return selectPropertyName(propertyOrSelector);
        }

        return propertyOrSelector;
    }

    public ensureProperty(
        propertyName: string,
        propertyPath: readonly string[] = [propertyName],
    ): MutablePropertyMetadata<TEntity> {
        const existing = this.properties.get(propertyName);
        if (existing) {
            return existing;
        }

        const created: MutablePropertyMetadata<TEntity> = {
            propertyName,
            propertyPath: [...propertyPath],
            columnName: propertyPath.join('_'),
            isRequired: false,
            isPrimaryKey: false,
            isUnique: false,
            isConcurrencyToken: false,
            isVersion: false,
            valueGenerated: ValueGenerated.Never,
        };

        this.properties.set(propertyName, created);
        return created;
    }

    public assertNotIgnored(propertyName: string): void {
        if (this.ignoredProperties.has(propertyName as EntityPropertyKey<TEntity>)) {
            throw new Error(`Property '${propertyName}' on entity '${this.ctor.name}' is ignored and cannot be configured.`);
        }
    }

    public finalizeProperties(): Array<PropertyMetadata<TEntity>> {
        return Array.from(this.properties.values()).map(property =>
            finalizeProperty(this.ctor, property));
    }

    public validateDuplicateColumns(properties: ReadonlyArray<PropertyMetadata<TEntity>>): void {
        validateDuplicateColumns(this.ctor, properties);
    }
}
