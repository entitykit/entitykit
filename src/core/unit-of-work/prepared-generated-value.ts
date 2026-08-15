import type { EntityMetadata } from '../../model/entity-metadata';
import type { PropertyMetadata } from '../../model/property-metadata';
import { toBoundProviderValue } from '../../model/value-converter/store-value';
import {
    readStoreProviderValue,
    type StoreValueReader,
} from '../../storage/store-value-reader';
import { snapshotProviderValueCopies } from '../../tracking/snapshot-value';
import { cloneSnapshotValue } from '../../tracking/snapshot-value-clone';
import type { AppliedPropertyValue } from './applied-generated-value';

/** Immutable provider facts captured before generated values reach application code. */
export interface PreparedGeneratedValue<TEntity extends object = object>
    extends AppliedPropertyValue {
    readonly property: PropertyMetadata<TEntity>;
    readonly liveValue: unknown;
}

export function prepareGeneratedRow<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    properties: ReadonlyArray<PropertyMetadata<TEntity>>,
    row: Readonly<Record<string, unknown>>,
    valueReader?: StoreValueReader,
): ReadonlyArray<PreparedGeneratedValue<TEntity>> {
    return Object.freeze(properties.map(property => prepareGeneratedValue(
        property,
        row[property.columnName],
        valueReader,
        metadata.entityName,
    )));
}

export function prepareGeneratedValue<TEntity extends object>(
    property: PropertyMetadata<TEntity>,
    storeValue: unknown,
    valueReader?: StoreValueReader,
    entityName?: string,
): PreparedGeneratedValue<TEntity> {
    const providerValue = readStoreProviderValue(
        storeValue,
        property,
        valueReader,
    );
    const context = entityName
        ? `${entityName}.${property.propertyName}`
        : property.propertyName;
    const { persistedValue, liveValue } = snapshotProviderValueCopies(
        providerValue,
        property.converter,
        context,
    );
    return Object.freeze({
        property,
        propertyName: property.propertyName,
        persistedValue,
        liveValue,
        boundValue: cloneSnapshotValue(toBoundProviderValue(
            providerValue,
            property.columnType,
            context,
        )),
    });
}
