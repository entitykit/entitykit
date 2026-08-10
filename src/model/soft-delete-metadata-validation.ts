import { toProviderValue } from './value-converter/store-value';
import type { PropertyMetadata } from './property-metadata';
import type {
    MutableSoftDeleteMetadata,
    SoftDeleteMetadata,
} from './saas-metadata';
import { isGeneratedOnUpdate } from './value-generated';

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
    if (configured.deletedValue !== undefined) {
        assertSoftDeleteProviderValue(
            entityName,
            property,
            configured.deletedValue,
        );
    }
    return {
        propertyName,
        deletedValue: configured.deletedValue,
    };
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
}
