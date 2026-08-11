import type { EntityMetadata } from '../model/entity-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
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

/** Capture only facts that must remain stable from initial tracking onward. */
export function captureTrackedBoundEntityValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    const tenantProperty = metadata.tenantKeyProperty;
    const relationshipProperties = new Set(metadata.relationships.flatMap(
        relationship => relationship.foreignKeyProperties as readonly string[],
    ));
    const alternateKeyProperties = new Set(metadata.alternateKeys.flatMap(
        key => key.propertyNames.map(String),
    ));
    return Object.fromEntries(metadata.properties
        .filter(property =>
            property.isPrimaryKey ||
            property.isConcurrencyToken ||
            property.propertyName === tenantProperty ||
            relationshipProperties.has(property.propertyName) ||
            alternateKeyProperties.has(property.propertyName))
        .map(property => [
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

export function cloneBoundValues(
    values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key,
        cloneSnapshotValue(value),
    ]));
}
