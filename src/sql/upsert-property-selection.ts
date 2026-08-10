import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import type { EntityPropertyKey } from '../types';
import {
    defaultUpsertUpdateProperties,
    isAlternateKeyProperty,
    isStoreGenerated,
} from './upsert-generated-properties';

export {
    assertResolvableUpsertConflict,
    defaultUpsertUpdateProperties,
    isStoreGenerated,
    upsertGeneratedProperties,
    upsertInsertProperties,
} from './upsert-generated-properties';
export function resolveConfiguredProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    propertyNames: ReadonlyArray<EntityPropertyKey<TEntity>>,
    optionName: string,
    label = 'Postgres upsert',
): Array<PropertyMetadata<TEntity>> {
    if (propertyNames.length === 0) {
        throw new Error(
            `${label} ${optionName} must select at least one property.`,
        );
    }

    const seen: Set<EntityPropertyKey<TEntity>> = new Set();
    return propertyNames.map(propertyName => {
        if (seen.has(propertyName)) {
            throw new Error(
                `${label} ${optionName} contains duplicate property '${metadata.entityName}.${propertyName}'.`,
            );
        }
        seen.add(propertyName);
        return metadata.getProperty(propertyName);
    });
}

export function resolveUpsertProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    options: {
        readonly conflictProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
        readonly updateProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    },
): {
    readonly conflictProperties: Array<PropertyMetadata<TEntity>>;
    readonly updateProperties: Array<PropertyMetadata<TEntity>>;
} {
    const conflictProperties = resolveConfiguredProperties(
        metadata,
        options.conflictProperties ?? metadata.keyProperties,
        'conflictProperties',
        'upsert',
    );
    const conflictNames = new Set(
        conflictProperties.map(property => property.propertyName),
    );
    const updateProperties = options.updateProperties
        ? resolveConfiguredProperties(
            metadata,
            options.updateProperties,
            'updateProperties',
            'upsert',
        )
        : defaultUpsertUpdateProperties(metadata, conflictNames);
    assertUpsertUpdates(metadata, updateProperties, conflictNames);
    return { conflictProperties, updateProperties };
}

function assertUpsertUpdates<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    updateProperties: ReadonlyArray<PropertyMetadata<TEntity>>,
    conflictNames: ReadonlySet<string>,
): void {
    if (updateProperties.length === 0) {
        throw new Error(
            `Upsert on '${metadata.entityName}' has nothing to update: every property is part of the conflict target. ` +
            'Use add(...) with saveChanges(), which already ignores an existing row\'s columns.',
        );
    }
    for (const property of updateProperties) {
        if (property.propertyName === metadata.tenantKeyProperty) {
            throw new Error(
                `Upsert updateProperties cannot include tenant property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
        if (property.isPrimaryKey) {
            throw new Error(
                `Upsert updateProperties cannot include primary-key property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
        if (isAlternateKeyProperty(metadata, property.propertyName)) {
            throw new Error(
                `Upsert updateProperties cannot include alternate-key property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
        if (property.isVersion) {
            throw new Error(
                `Upsert updateProperties cannot include version property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
        if (conflictNames.has(property.propertyName)) {
            throw new Error(
                `Upsert updateProperties cannot include conflict property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
        if (isStoreGenerated(property)) {
            throw new Error(
                `Upsert updateProperties cannot include store-generated property '${metadata.entityName}.${property.propertyName}'.`,
            );
        }
    }
}
