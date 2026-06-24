import type { EntityMetadata } from '../model/entity-metadata';
import {
    hasPropertyPath,
    readPropertyValue,
} from '../model/property-value-access';
import type { PropertyMetadata } from '../model/property-metadata';
import type { EntityUpdateValues } from '../types';
import { validateRequiredComplexProperties } from './required-complex-property-validation';

export interface MappedUpdateValue {
    readonly property: PropertyMetadata;
    readonly value: unknown;
}

/** Flatten an update object's supplied scalar and complex leaf values. */
export function mappedUpdateValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: EntityUpdateValues<TEntity>,
): readonly MappedUpdateValue[] {
    validateRequiredComplexProperties(metadata, values, true);
    return metadata.properties
        .filter(property => hasPropertyPath(values, property.propertyPath))
        .map(property => ({
            property,
            value: readPropertyValue(values, property),
        }));
}
