import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import {
    isAlternateKeyProperty,
    isStoreGenerated,
} from './upsert-generated-properties';

export function assertUpsertUpdates<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    updateProperties: ReadonlyArray<PropertyMetadata<TEntity>>,
    conflictNames: ReadonlySet<string>,
    label = 'Upsert',
): void {
    if (updateProperties.length === 0) {
        if (label !== 'Upsert') {
            throw new Error(
                `${label} statements must update at least one non-conflict property.`,
            );
        }
        throw new Error(
            `Upsert on '${metadata.entityName}' has nothing to update: every property is part of the conflict target. ` +
            'Use add(...) with saveChanges(), which already ignores an existing row\'s columns.',
        );
    }
    for (const property of updateProperties) {
        assertUpsertUpdate(metadata, property, conflictNames, label);
    }
}

function assertUpsertUpdate<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    property: PropertyMetadata<TEntity>,
    conflictNames: ReadonlySet<string>,
    label: string,
): void {
    const identity = `${metadata.entityName}.${property.propertyName}`;
    if (property.propertyName === metadata.tenantKeyProperty) {
        throw new Error(
            `${label} updateProperties cannot include tenant property '${identity}'.`,
        );
    }
    if (property.isPrimaryKey) {
        throw new Error(
            `${label} updateProperties cannot include primary-key property '${identity}'.`,
        );
    }
    if (isAlternateKeyProperty(metadata, property.propertyName)) {
        throw new Error(
            `${label} updateProperties cannot include alternate-key property '${identity}'.`,
        );
    }
    if (property.isVersion) {
        throw new Error(
            `${label} updateProperties cannot include version property '${identity}'.`,
        );
    }
    if (conflictNames.has(property.propertyName)) {
        throw new Error(
            `${label} updateProperties cannot include conflict property '${identity}'.`,
        );
    }
    if (isStoreGenerated(property)) {
        throw new Error(
            `${label} updateProperties cannot include store-generated property '${identity}'.`,
        );
    }
}
