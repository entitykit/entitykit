import type { PropertyMetadata } from './property-metadata';
import { isGeneratedOnAdd, isGeneratedOnUpdate } from './value-generated';

export function assertTenantKeyNotStoreGenerated(
    entityName: string,
    tenantProperty: string | undefined,
    properties: readonly PropertyMetadata[],
): void {
    if (!tenantProperty) {
        return;
    }
    const property = properties.find(candidate =>
        candidate.propertyName === tenantProperty);
    if (
        property &&
        (isGeneratedOnAdd(property.valueGenerated) ||
            isGeneratedOnUpdate(property.valueGenerated) ||
            property.computedSql !== undefined ||
            property.storeGeneration !== undefined)
    ) {
        throw new Error(
            `Tenant property '${entityName}.${property.propertyName}' cannot be store-generated. ` +
            'Tenant identity must be supplied and verified before SQL execution.',
        );
    }
}
