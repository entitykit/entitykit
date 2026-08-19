import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import type { EntityPropertyKey } from '../types';
import {
    defaultUpsertUpdateProperties,
} from './upsert-generated-properties';
import { assertUpsertUpdates } from './upsert-update-validation';

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
    label = 'upsert',
): {
    readonly conflictProperties: Array<PropertyMetadata<TEntity>>;
    readonly updateProperties: Array<PropertyMetadata<TEntity>>;
} {
    const conflictProperties = resolveConfiguredProperties(
        metadata,
        options.conflictProperties ?? metadata.keyProperties,
        'conflictProperties',
        label,
    );
    const conflictNames = new Set(
        conflictProperties.map(property => property.propertyName),
    );
    const updateProperties = options.updateProperties
        ? resolveConfiguredProperties(
            metadata,
            options.updateProperties,
            'updateProperties',
            label,
        )
        : defaultUpsertUpdateProperties(metadata, conflictNames);
    const validationLabel = label === 'upsert' ? 'Upsert' : label;
    assertUpsertUpdates(
        metadata,
        updateProperties,
        conflictNames,
        validationLabel,
    );
    return { conflictProperties, updateProperties };
}
