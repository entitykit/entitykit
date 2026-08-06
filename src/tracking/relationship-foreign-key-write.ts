import { writePropertyValue } from '../model/property-value-access';
import type { EntityEntry } from './entity-entry';

export function writeRelationshipForeignKey(
    dependent: EntityEntry<object>,
    properties: readonly string[],
    values: readonly unknown[],
): void {
    properties.forEach((property, index) => {
        writePropertyValue(
            dependent.entity,
            dependent.metadata.getProperty(property),
            values[index],
        );
    });
}

export function clearOptionalRelationshipForeignKey(
    dependent: EntityEntry<object>,
    properties: readonly string[],
): void {
    for (const property of properties) {
        const metadata = dependent.metadata.getProperty(property);
        if (!metadata.isRequired) {
            writePropertyValue(dependent.entity, metadata, null);
        }
    }
}
