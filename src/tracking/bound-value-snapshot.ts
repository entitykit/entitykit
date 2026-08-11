import type { EntityMetadata } from '../model/entity-metadata';
import {
    toBoundPropertyValue,
    toBoundProviderValue,
} from '../model/value-converter/store-value';
import { cloneSnapshotValue } from './snapshot-value-clone';

/** Capture the exact provider representations of one model-value snapshot. */
export function captureBoundEntityValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    return Object.fromEntries(metadata.properties.map(property => [
        property.propertyName,
        cloneSnapshotValue(toBoundPropertyValue(
            values[property.propertyName],
            property,
            metadata.entityName,
        )),
    ]));
}

/** Fill uncaptured properties after save-time policy writes have completed. */
export function captureMissingBoundEntityValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    boundValues: Record<string, unknown>,
): void {
    for (const property of metadata.properties) {
        if (Object.prototype.hasOwnProperty.call(
            boundValues,
            property.propertyName,
        )) {
            continue;
        }
        boundValues[property.propertyName] = cloneSnapshotValue(
            toBoundPropertyValue(
                values[property.propertyName],
                property,
                metadata.entityName,
            ),
        );
    }
}

/** Preserve provider values already returned by a database row. */
export function captureBoundRowValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    return Object.fromEntries(metadata.properties.map(property => [
        property.propertyName,
        cloneSnapshotValue(toBoundProviderValue(
            row[property.columnName],
            property.columnType,
            `${metadata.entityName}.${property.propertyName}`,
        )),
    ]));
}

export function cloneBoundValues(
    values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key,
        cloneSnapshotValue(value),
    ]));
}
