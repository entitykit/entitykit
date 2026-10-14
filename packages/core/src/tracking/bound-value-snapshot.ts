import { writeSnapshotValue } from './write-snapshot-value';
import { types } from 'node:util';
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
        writeSnapshotValue(boundValues, property.propertyName, cloneSnapshotValue(
            toBoundPropertyValue(
                values[property.propertyName],
                property,
                metadata.entityName,
            ),
        ));
    }
}

export function cloneBoundValues(
    values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    // Preserve the single enumeration and string-only accessor behavior for
    // proxies and symbol-bearing records. Ordinary records need no entry pairs.
    if (types.isProxy(values) || Object.getOwnPropertySymbols(values).length !== 0) {
        return Object.fromEntries(Object.entries(values).map(([key, value]) => [
            key,
            cloneSnapshotValue(value),
        ]));
    }
    // Capture every root getter before cloning nested values. Spread creates
    // owned data properties, so assignment also preserves special own keys.
    const cloned = { ...values };
    for (const key of Object.keys(cloned)) {
        cloned[key] = cloneSnapshotValue(cloned[key]);
    }
    return cloned;
}
