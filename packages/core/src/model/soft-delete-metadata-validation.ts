import { toProviderValue } from './value-converter/store-value';
import type { PropertyMetadata } from './property-metadata';
import type {
    MutableSoftDeleteMetadata,
    SoftDeleteMetadata,
} from './saas-metadata';
import {
    isGeneratedOnAdd,
    isGeneratedOnUpdate,
} from './value-generated';

export function finalizeSoftDeleteMetadata<TEntity extends object>(
    entityName: string,
    configured: MutableSoftDeleteMetadata<TEntity> | undefined,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
): SoftDeleteMetadata<TEntity> | undefined {
    if (!configured?.propertyName) return undefined;
    const propertyName = configured.propertyName;
    const property = properties.find(
        candidate => candidate.propertyName === propertyName,
    );
    if (!property) {
        throw new Error(
            `Soft delete configuration on entity '${entityName}' references unconfigured property '${propertyName}'.`,
        );
    }
    if (property.isRequired) {
        throw new Error(
            `Soft delete property '${propertyName}' on entity '${entityName}' must be nullable, because a live row is one whose marker is null.`,
        );
    }
    if (
        property.computedSql !== undefined ||
        isGeneratedOnUpdate(property.valueGenerated)
    ) {
        throw new Error(
            `Soft delete property '${entityName}.${propertyName}' cannot be computed or generated on update, because remove() must write its deleted marker.`,
        );
    }
    if (
        isGeneratedOnAdd(property.valueGenerated) &&
        !hasNullGeneratedDefault(property)
    ) {
        throw new Error(
            `Soft delete property '${entityName}.${propertyName}' can be generated on add only when its database live-row default is SQL NULL.`,
        );
    }
    if (configured.deletedValue !== undefined) {
        assertSoftDeleteProviderValue(
            entityName,
            property,
            configured.deletedValue,
        );
    } else if (!usesTimestampConvention(configured, property)) {
        throw new Error(
            `Soft delete property '${entityName}.${propertyName}' must configure an explicit deleted value unless it uses the Date timestamp convention.`,
        );
    }
    return {
        propertyName,
        deletedValue: configured.deletedValue,
    };
}

function usesTimestampConvention<TEntity extends object>(
    configured: MutableSoftDeleteMetadata<TEntity>,
    property: PropertyMetadata<TEntity>,
): boolean {
    if (configured.usesTimestampConvention !== true) return false;
    const columnType = property.columnType.trim().toLowerCase();
    return property.converter !== undefined ||
        columnType === 'date' ||
        columnType.startsWith('datetime') ||
        columnType.startsWith('timestamp');
}

function hasNullGeneratedDefault(property: PropertyMetadata): boolean {
    if (property.storeGeneration !== undefined) {
        return false;
    }
    if (property.defaultSql !== undefined) {
        return property.defaultSql.trim().toLowerCase() === 'null';
    }
    return property.defaultValue === undefined || property.defaultValue === null;
}

export function assertSoftDeleteProviderValue(
    entityName: string,
    property: PropertyMetadata,
    value: unknown,
): void {
    const providerValue = toProviderValue(
        value,
        property.converter,
        `${entityName}.${property.propertyName}`,
    );
    assertSoftDeletePersistedValue(
        entityName,
        property.propertyName,
        providerValue,
    );
}

export function assertSoftDeletePersistedValue(
    entityName: string,
    propertyName: string,
    value: unknown,
): void {
    if (value === null || value === undefined) {
        throw new Error(
            `Soft delete property '${entityName}.${propertyName}' must write a non-null provider value, because SQL NULL represents a live row.`,
        );
    }
    if (typeof value === 'number' && Number.isNaN(value)) {
        throw new Error(
            `Soft delete property '${entityName}.${propertyName}' cannot write NaN, because SQL providers do not share NaN persistence semantics.`,
        );
    }
}
