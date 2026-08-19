import type { EntityConstructor } from '../types';
import type { MutablePropertyMetadata, PropertyMetadata } from './property-metadata';
import { ValueGenerated } from './value-generated';
import { validateStoreGeneration } from './store-generation';

export function finalizeProperty<TEntity extends object>(
    ctor: EntityConstructor<TEntity>,
    property: MutablePropertyMetadata<TEntity>,
): PropertyMetadata<TEntity> {
    if (!property.columnName) {
        throw new Error(`Property '${property.propertyName}' on entity '${ctor.name}' must configure a column name.`);
    }
    if (!property.columnType) {
        throw new Error(`Property '${property.propertyName}' on entity '${ctor.name}' must configure a column type.`);
    }
    if (property.defaultValue !== undefined && property.defaultSql !== undefined) {
        throw new Error(`Property '${property.propertyName}' on entity '${ctor.name}' cannot configure both a default value and default SQL.`);
    }
    if (
        property.computedSql !== undefined &&
        (property.defaultValue !== undefined || property.defaultSql !== undefined)
    ) {
        throw new Error(`Computed property '${property.propertyName}' on entity '${ctor.name}' cannot also configure a default.`);
    }
    if (property.isPrimaryKey && property.computedSql !== undefined) {
        throw new Error(`Primary key property '${property.propertyName}' on entity '${ctor.name}' cannot be computed.`);
    }
    if (
        property.computedSql !== undefined &&
        property.valueGenerated !== ValueGenerated.OnAddOrUpdate
    ) {
        throw new Error(
            `Computed property '${property.propertyName}' on entity '${ctor.name}' must remain generated on add or update.`,
        );
    }
    if (property.storeGeneration !== undefined) {
        validateStoreGeneration(property.storeGeneration);
        if (
            property.defaultValue !== undefined ||
            property.defaultSql !== undefined ||
            property.computedSql !== undefined
        ) {
            throw new Error(
                `Store-generated property '${property.propertyName}' on entity '${ctor.name}' cannot also configure a default or computed expression.`,
            );
        }
        if (property.valueGenerated !== ValueGenerated.OnAdd) {
            throw new Error(
                `Store-generated property '${property.propertyName}' on entity '${ctor.name}' must remain generated on add.`,
            );
        }
    }
    if (
        property.isVersion &&
        property.valueGenerated !== undefined &&
        property.valueGenerated !== ValueGenerated.Never
    ) {
        throw new Error(
            `Version property '${property.propertyName}' on entity '${ctor.name}' cannot be database-generated. Configure it as a concurrency token when the database owns the value.`,
        );
    }
    if (property.isPrimaryKey && property.valueGenerated === ValueGenerated.OnAddOrUpdate) {
        throw new Error(
            `Primary key property '${property.propertyName}' on entity '${ctor.name}' cannot be generated on update.`,
        );
    }
    return {
        propertyName: property.propertyName,
        propertyPath: property.propertyPath ?? [property.propertyName],
        columnName: property.columnName,
        columnType: property.columnType,
        isRequired: property.isRequired ?? false,
        isPrimaryKey: property.isPrimaryKey ?? false,
        isUnique: property.isUnique ?? false,
        maxLength: property.maxLength,
        defaultValue: property.defaultValue,
        defaultSql: property.defaultSql,
        computedSql: property.computedSql,
        computedStored: property.computedStored,
        collation: property.collation,
        storeGeneration: property.storeGeneration
            ? { ...property.storeGeneration }
            : undefined,
        converter: property.converter,
        isConcurrencyToken: property.isConcurrencyToken ?? false,
        isVersion: property.isVersion ?? false,
        valueGenerated: property.valueGenerated ?? ValueGenerated.Never,
    };
}
