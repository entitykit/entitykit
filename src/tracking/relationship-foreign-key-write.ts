import { readPropertyValue, writePropertyValue } from '../model/property-value-access';
import type { EntityEntry } from './entity-entry';
import {
    snapshotPropertyValue,
    snapshotPropertyValuesEqual,
} from './snapshot-value';

export function writeRelationshipForeignKey(
    dependent: EntityEntry<object>,
    properties: readonly string[],
    values: readonly unknown[],
    captured?: Record<string, unknown>,
): void {
    properties.forEach((property, index) => {
        const metadata = dependent.metadata.getProperty(property);
        const context = `${dependent.metadata.entityName}.${property}`;
        const intended = snapshotPropertyValue(
            values[index], metadata.converter, context,
        );
        const unchanged = captured
            ? snapshotPropertyValuesEqual(
                captured[property],
                values[index],
                metadata.converter,
                context,
            )
            : snapshotPropertyValuesEqual(
                readPropertyValue(dependent.entity, metadata),
                intended,
                metadata.converter,
                context,
            );
        if (!unchanged) {
            writePropertyValue(dependent.entity, metadata, values[index]);
        }
        if (captured) {
            captured[property] = intended;
        }
    });
}

export function clearOptionalRelationshipForeignKey(
    dependent: EntityEntry<object>,
    properties: readonly string[],
    captured?: Record<string, unknown>,
): void {
    for (const property of properties) {
        const metadata = dependent.metadata.getProperty(property);
        if (!metadata.isRequired) {
            const context = `${dependent.metadata.entityName}.${property}`;
            const current = captured
                ? captured[property]
                : readPropertyValue(dependent.entity, metadata);
            if (!snapshotPropertyValuesEqual(
                current, null, metadata.converter, context,
            )) {
                writePropertyValue(dependent.entity, metadata, null);
            }
            if (captured) captured[property] = null;
        }
    }
}
