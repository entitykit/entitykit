import type { EntityMetadata } from '../model/entity-metadata';
import {
    snapshotPropertyValue,
    snapshotPropertyValuesEqual,
} from './snapshot-value';
import { isGeneratedOnUpdate } from '../model/value-generated';
import { readPropertyValue } from '../model/property-value-access';

export { cloneSnapshotValue } from './snapshot-value';

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
            !isGeneratedOnUpdate(property.valueGenerated) &&
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
            !isGeneratedOnUpdate(property.valueGenerated) &&
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
        !isGeneratedOnUpdate(property.valueGenerated) &&
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
        !isGeneratedOnUpdate(property.valueGenerated) &&
        !snapshotPropertyValuesEqual(
            values[property.propertyName],
            snapshot[property.propertyName],
            property.converter,
            `${metadata.entityName}.${property.propertyName}`,
        ),
    );
}
