import { ensureComplexPropertyPath } from '../../materialization/complex-value-materializer';
import type { EntityMetadata } from '../../model/entity-metadata';
import {
    propertyValueTarget,
    writePropertyValue,
} from '../../model/property-value-access';
import type { PropertyMetadata } from '../../model/property-metadata';
import { readStoreValue, type StoreValueReader } from '../../storage/store-value-reader';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { AppliedPropertyValue } from './applied-generated-value';
import { snapshotPropertyValueCopies } from '../../tracking/snapshot-value';

export function writeGeneratedRow(
    entity: object,
    metadata: EntityMetadata,
    properties: readonly PropertyMetadata[],
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

export function writeGeneratedValue(
    entity: object,
    property: PropertyMetadata,
    storeValue: unknown,
    mutations: SaveTimeMutationLog,
    valueReader?: StoreValueReader,
    metadata?: EntityMetadata,
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
        ensureComplexPropertyPath(
            metadata,
            entity,
            property.propertyPath,
            (target, propertyName) => {
                mutations.record(target, propertyName);
            },
        );
    }
    const target = propertyValueTarget(entity, property.propertyPath);
    mutations.record(target.target, target.propertyName);
    writePropertyValue(entity, property, liveValue);
    return persistedValue;
}
