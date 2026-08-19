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
    const managedNames = managedUpsertPropertyNames(metadata);
    return metadata.properties.filter(property =>
        !property.isPrimaryKey &&
        !property.isConcurrencyToken &&
        !isAlternateKeyProperty(metadata, property.propertyName) &&
        !conflictNames.has(property.propertyName) &&
        !managedNames.has(property.propertyName) &&
        !isStoreGenerated(property));
}

export function isAlternateKeyProperty<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    propertyName: string,
): boolean {
    return metadata.alternateKeys.some(key =>
        key.propertyNames.some(keyProperty => keyProperty === propertyName));
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
        property.computedSql !== undefined ||
        property.storeGeneration !== undefined;
}

function managedUpsertPropertyNames<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
): Set<string> {
    const audit = metadata.audit;
    const names: Set<string> = new Set();
    for (const property of [
        metadata.tenantKeyProperty,
        metadata.softDelete?.propertyName,
        audit?.createdAtProperty,
        audit?.updatedAtProperty,
        audit?.createdByProperty,
        audit?.updatedByProperty,
    ]) {
        if (property !== undefined) {
            names.add(property);
        }
    }
    return names;
}
