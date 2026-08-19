import type { EntityMetadata } from '../model/entity-metadata';
import {
    fromProviderValue,
    toBoundProviderValue,
} from '../model/value-converter/store-value';
import {
    readStoreProviderValue,
    type StoreValueReader,
} from '../storage/store-value-reader';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';

export interface MaterializedValueCapture {
    readonly values: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
}

/** Normalize every raw row property once, then derive both model and bound facts. */
export function captureMaterializedValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    row: Readonly<Record<string, unknown>>,
    reader?: StoreValueReader,
): MaterializedValueCapture {
    const values: Record<string, unknown> = {};
    const boundValues: Record<string, unknown> = {};
    for (const property of metadata.properties) {
        const context = `${metadata.entityName}.${property.propertyName}`;
        const providerValue = readStoreProviderValue(
            row[property.columnName], property, reader,
        );
        values[property.propertyName] = fromProviderValue(
            cloneSnapshotValue(providerValue), property.converter, context,
        );
        boundValues[property.propertyName] = cloneSnapshotValue(
            toBoundProviderValue(
                cloneSnapshotValue(providerValue),
                property.columnType,
                context,
            ),
        );
    }
    return { values, boundValues };
}
