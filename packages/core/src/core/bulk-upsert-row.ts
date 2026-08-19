import type { EntityMetadata } from '../model/entity-metadata';
import {
    readPropertyPath,
    readPropertyValue,
} from '../model/property-value-access';
import { validateRequiredPropertyValues } from '../sql/captured-value-sql-helpers';
import { validateRequiredComplexPropertyValues } from '../sql/required-complex-property-validation';
import { upsertInsertProperties } from '../sql/upsert-property-selection';
import { toBoundProviderValue } from '../model/value-converter/store-value';
import { snapshotPropertyValueCopies } from '../tracking/snapshot-value';

export interface CapturedBulkUpsertRow<TEntity extends object> {
    readonly entity: TEntity;
    readonly values: Readonly<Record<string, unknown>>;
    readonly providerValues: Readonly<Record<string, unknown>>;
}

/** Capture and validate one row before bulk upsert performs database work. */
export function captureBulkUpsertRow<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
): CapturedBulkUpsertRow<TEntity> {
    const values: Record<string, unknown> = {};
    const providerValues: Record<string, unknown> = {};
    const insertProperties = new Set(upsertInsertProperties(metadata));
    for (const property of metadata.properties) {
        const context = `${metadata.entityName}.${property.propertyName}`;
        const copies = snapshotPropertyValueCopies(
            readPropertyValue(entity, property),
            property.converter,
            context,
        );
        values[property.propertyName] = copies.persistedValue;
        if (insertProperties.has(property)) {
            providerValues[property.propertyName] = toBoundProviderValue(
                copies.providerValue,
                property.columnType,
                context,
            );
        }
    }
    validateRequiredPropertyValues(metadata, values, { forInsert: true });
    validateRequiredComplexPropertyValues(
        metadata,
        Object.fromEntries(metadata.complexProperties.map(property => [
            property.propertyName,
            readPropertyPath(entity, property.propertyPath),
        ])),
    );
    return {
        entity,
        values: Object.freeze(values),
        providerValues: Object.freeze(providerValues),
    };
}
