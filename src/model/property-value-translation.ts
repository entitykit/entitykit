import type { EntityMetadata } from './entity-metadata';
import type { PropertyMetadata } from './property-metadata';
import {
    fromProviderValue,
    toProviderValue,
} from './value-converter/store-value';
import { cloneSnapshotValue } from '../tracking/snapshot-value';

/** Translate one model value through its shared provider representation. */
export function translatePropertyValue<
    TSource extends object,
    TTarget extends object,
>(
    value: unknown,
    sourceMetadata: EntityMetadata<TSource>,
    sourceProperty: PropertyMetadata,
    targetMetadata: EntityMetadata<TTarget>,
    targetProperty: PropertyMetadata,
): unknown {
    const providerValue = cloneSnapshotValue(toProviderValue(
        value,
        sourceProperty.converter,
        `${sourceMetadata.entityName}.${sourceProperty.propertyName}`,
    ));
    return fromProviderValue(
        cloneSnapshotValue(providerValue),
        targetProperty.converter,
        `${targetMetadata.entityName}.${targetProperty.propertyName}`,
    );
}
