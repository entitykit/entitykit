import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import {
    isGeneratedOnAdd,
    isGeneratedOnUpdate,
} from '../model/value-generated';
import { assertTenantKeyNotStoreGenerated } from '../model/generated-tenant-key-validation';

export function defaultUpsertUpdateProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    conflictNames: ReadonlySet<string>,
): Array<PropertyMetadata<TEntity>> {
    return metadata.properties.filter(property =>
        !property.isPrimaryKey &&
        !conflictNames.has(property.propertyName) &&
        property.propertyName !== metadata.tenantKeyProperty &&
        !isStoreGenerated(property));
}

export function upsertInsertProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
): Array<PropertyMetadata<TEntity>> {
    return metadata.properties.filter(property =>
        !isGeneratedOnAdd(property.valueGenerated));
}

export function upsertGeneratedProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
): Array<PropertyMetadata<TEntity>> {
    assertTenantKeyNotStoreGenerated(
        metadata.entityName,
        metadata.tenantKeyProperty,
        metadata.properties,
    );
    return metadata.properties.filter(property =>
        isGeneratedOnAdd(property.valueGenerated));
}

export function assertResolvableUpsertConflict<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
): void {
    const generated = properties.find(property =>
        isGeneratedOnAdd(property.valueGenerated));
    if (generated) {
        throw new Error(
            `Upsert for '${metadata.entityName}' cannot use unresolved store-generated key '${generated.propertyName}' as its conflict target. ` +
            'Select a natural unique key or use add() and saveChanges().',
        );
    }
}

export function isStoreGenerated(property: PropertyMetadata): boolean {
    return isGeneratedOnAdd(property.valueGenerated) ||
        isGeneratedOnUpdate(property.valueGenerated) ||
        property.computedSql !== undefined;
}
