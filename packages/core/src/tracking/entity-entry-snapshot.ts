import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import {
    snapshotPropertyValue,
    snapshotPropertyValuesEqual,
} from './snapshot-value';
import { isGeneratedOnUpdate } from '../model/value-generated';
import { readPropertyValue } from '../model/property-value-access';

export { cloneSnapshotValue } from './snapshot-value';

/**
 * Whether a difference in this property is one change detection judges.
 *
 * A `valueGeneratedOnAddOrUpdate` column belongs to the store: left out of every
 * INSERT and UPDATE, hydrated back off the row afterwards. An assignment to one
 * can never be persisted, so it is not a modification, never moves an entry to
 * Modified, and never appears in `modifiedProperties()`. That makes this the one
 * definition of "a difference that could be durable work" -- exported so
 * anything agreeing with change detection reuses it instead of restating it.
 */
export function isChangeDetectedProperty(
    property: Pick<PropertyMetadata, 'valueGenerated'>,
): boolean {
    return !isGeneratedOnUpdate(property.valueGenerated);
}

export function readEntityValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const property of metadata.properties) {
        values[property.propertyName] = snapshotPropertyValue(
            readPropertyValue(entity, property),
            property.converter,
            `${metadata.entityName}.${property.propertyName}`,
        );
    }
    return values;
}

export function cloneEntityValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Record<string, unknown>,
): Record<string, unknown> {
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        cloned[key] = snapshotPropertyValue(
            value,
            metadata.tryGetProperty(key)?.converter,
            `${metadata.entityName}.${key}`,
        );
    }
    return cloned;
}

export function modifiedEntityProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    snapshot: Readonly<Record<string, unknown>>,
): string[] {
    return metadata.properties
        .filter(property =>
            isChangeDetectedProperty(property) &&
            !snapshotPropertyValuesEqual(
                readPropertyValue(entity, property),
                snapshot[property.propertyName],
                property.converter as never,
                `${metadata.entityName}.${property.propertyName}`,
            ),
        )
        .map(property => property.propertyName);
}

export function modifiedEntityValueProperties<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    snapshot: Readonly<Record<string, unknown>>,
): string[] {
    return metadata.properties
        .filter(property =>
            isChangeDetectedProperty(property) &&
            !snapshotPropertyValuesEqual(
                values[property.propertyName],
                snapshot[property.propertyName],
                property.converter as never,
                `${metadata.entityName}.${property.propertyName}`,
            ),
        )
        .map(property => property.propertyName);
}

export function hasEntityModifications<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    snapshot: Readonly<Record<string, unknown>>,
): boolean {
    return metadata.properties.some(property =>
        isChangeDetectedProperty(property) &&
        !snapshotPropertyValuesEqual(
            readPropertyValue(entity, property),
            snapshot[property.propertyName],
            property.converter,
            `${metadata.entityName}.${property.propertyName}`,
        ),
    );
}

export function hasEntityValueModifications<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    snapshot: Readonly<Record<string, unknown>>,
): boolean {
    return metadata.properties.some(property =>
        isChangeDetectedProperty(property) &&
        !snapshotPropertyValuesEqual(
            values[property.propertyName],
            snapshot[property.propertyName],
            property.converter,
            `${metadata.entityName}.${property.propertyName}`,
        ),
    );
}
