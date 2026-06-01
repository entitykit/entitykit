import type { EntityConstructor } from '../types';
import type { PropertyMetadata } from './property-metadata';

export function validateDuplicateColumns<TEntity extends object>(
    ctor: EntityConstructor<TEntity>,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
): void {
    const seen: Map<string, string> = new Map();
    for (const property of properties) {
        const existing = seen.get(property.columnName);
        if (existing) {
            throw new Error(
                `Entity '${ctor.name}' maps properties '${existing}' and '${property.propertyName}' to the same column '${property.columnName}'.`,
            );
        }
        seen.set(property.columnName, property.propertyName);
    }
}
