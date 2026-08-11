import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import { toBoundProviderValue } from '../model/value-converter/store-value';
import { snapshotPropertyValueCopies } from './snapshot-value';

export interface EntityPersistenceFacts {
    readonly modelValues: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
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
        const context = `${metadata.entityName}.${property.propertyName}`;
        const copies = snapshotPropertyValueCopies(
            readPropertyValue(entity, property),
            property.converter,
            context,
        );
        modelValues[property.propertyName] = copies.persistedValue;
        boundValues[property.propertyName] = toBoundProviderValue(
            copies.providerValue,
            property.columnType,
            context,
        );
    }
    return { modelValues, boundValues };
}
