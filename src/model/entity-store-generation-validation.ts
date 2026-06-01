import type { EntityPropertyKey } from '../types';
import type { PropertyMetadata } from './property-metadata';

export function validateEntityStoreGeneration<TEntity extends object>(
    entityName: string,
    keyProperties: ReadonlyArray<EntityPropertyKey<TEntity>>,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
): void {
    const singletonStrategies = properties.filter(property =>
        property.storeGeneration?.kind === 'autoIncrement' ||
        property.storeGeneration?.kind === 'rowid');
    if (singletonStrategies.length > 1) {
        throw new Error(
            `Entity '${entityName}' cannot configure more than one auto-increment or rowid column.`,
        );
    }
    for (const property of singletonStrategies) {
        if (property.storeGeneration?.kind === 'autoIncrement') {
            if (keyProperties[0] === property.propertyName) {
                continue;
            }
            throw new Error(
                `Store-generated property '${property.propertyName}' on entity '${entityName}' must be the first property of its primary key when using 'autoIncrement'.`,
            );
        }
        if (keyProperties.length !== 1 ||
            keyProperties[0] !== property.propertyName) {
            throw new Error(
                `Store-generated property '${property.propertyName}' on entity '${entityName}' must be its single-column primary key when using '${String(property.storeGeneration?.kind)}'.`,
            );
        }
    }
}
