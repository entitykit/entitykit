import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import type { EntityPropertyKey } from '../types';

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
