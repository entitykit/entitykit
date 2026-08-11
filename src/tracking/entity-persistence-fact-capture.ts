import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import { toBoundProviderValue } from '../model/value-converter/store-value';
import { snapshotPropertyValueCopies } from './snapshot-value';
import type { PropertyMetadata } from '../model/property-metadata';

export interface EntityPersistenceFacts {
    readonly modelValues: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
}

export interface PropertyPersistenceFact {
    readonly modelValue: unknown;
    readonly boundValue: unknown;
}

/** Capture one already-read model value through one converter pass. */
export function capturePropertyPersistenceFact<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    property: PropertyMetadata<TEntity>,
    value: unknown,
): PropertyPersistenceFact {
    const context = `${metadata.entityName}.${property.propertyName}`;
    const copies = snapshotPropertyValueCopies(
        value, property.converter, context,
    );
    return {
        modelValue: copies.persistedValue,
        boundValue: toBoundProviderValue(
            copies.providerValue, property.columnType, context,
        ),
    };
}

/** Capture model snapshots and provider facts through one converter pass. */
export function captureEntityPersistenceFacts<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    propertyNames?: ReadonlySet<string>,
): EntityPersistenceFacts {
    const modelValues: Record<string, unknown> = {};
    const boundValues: Record<string, unknown> = {};
    for (const property of metadata.properties) {
        if (propertyNames && !propertyNames.has(property.propertyName)) {
            continue;
        }
        const captured = capturePropertyPersistenceFact(
            metadata, property, readPropertyValue(entity, property),
        );
        modelValues[property.propertyName] = captured.modelValue;
        boundValues[property.propertyName] = captured.boundValue;
    }
    return { modelValues, boundValues };
}
