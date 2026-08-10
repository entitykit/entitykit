import type { EntityMetadata } from '../../model/entity-metadata';
import {
    readPropertyPath,
    readPropertyValue,
    writePropertyValue,
} from '../../model/property-value-access';
import type { PropertyMetadata } from '../../model/property-metadata';
import { readStoreValue, type StoreValueReader } from '../../storage/store-value-reader';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { AppliedPropertyValue } from './applied-generated-value';
import { snapshotPropertyValueCopies } from '../../tracking/snapshot-value';
import { ensurePolicyPropertyPath } from '../policy-property-path';

export function writeGeneratedRow<TEntity extends object>(
    entity: TEntity,
    metadata: EntityMetadata<TEntity>,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
    row: Record<string, unknown>,
    mutations: SaveTimeMutationLog,
    valueReader?: StoreValueReader,
): readonly AppliedPropertyValue[] {
    const applied: AppliedPropertyValue[] = [];
    for (const property of properties) {
        const persistedValue = writeGeneratedValue(
            entity,
            property,
            row[property.columnName],
            mutations,
            valueReader,
            metadata,
        );
        applied.push({ propertyName: property.propertyName, persistedValue });
    }
    return applied;
}

export function writeGeneratedValue<TEntity extends object>(
    entity: TEntity,
    property: PropertyMetadata<TEntity>,
    storeValue: unknown,
    mutations: SaveTimeMutationLog,
    valueReader?: StoreValueReader,
    metadata?: EntityMetadata<TEntity>,
    entityName = metadata?.entityName,
): unknown {
    const value = readStoreValue(
        storeValue,
        property,
        valueReader,
        entityName,
    );
    const context = entityName
        ? `${entityName}.${property.propertyName}`
        : property.propertyName;
    const { persistedValue, liveValue } = snapshotPropertyValueCopies(
        value,
        property.converter,
        context,
    );
    if (metadata && liveValue !== null && liveValue !== undefined) {
        ensurePolicyPropertyPath(
            metadata,
            entity,
            property,
            mutations,
        );
    }
    const parentPath = property.propertyPath.slice(0, -1);
    const parent = readPropertyPath(entity, parentPath);
    if (
        parentPath.length > 0 &&
        (parent === null || parent === undefined)
    ) {
        return persistedValue;
    }
    const previous = readPropertyValue(entity, property);
    writePropertyValue(entity, property, liveValue);
    let applied: unknown;
    try {
        applied = readPropertyValue(entity, property);
    } catch (error) {
        writePropertyValue(entity, property, previous);
        throw error;
    }
    mutations.recordApplied(
        entity,
        property,
        previous,
        applied,
        context,
    );
    return persistedValue;
}
