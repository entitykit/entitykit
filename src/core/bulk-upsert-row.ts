import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyPath } from '../model/property-value-access';
import { validateRequiredPropertyValues } from '../sql/captured-value-sql-helpers';
import { validateRequiredComplexPropertyValues } from '../sql/required-complex-property-validation';
import { upsertInsertProperties } from '../sql/upsert-property-selection';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { readEntityValues } from '../tracking/entity-entry-snapshot';
import { cloneSnapshotValue } from '../tracking/snapshot-value';

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
    const values = readEntityValues(metadata, entity);
    validateRequiredPropertyValues(metadata, values, { forInsert: true });
    validateRequiredComplexPropertyValues(
        metadata,
        Object.fromEntries(metadata.complexProperties.map(property => [
            property.propertyName,
            readPropertyPath(entity, property.propertyPath),
        ])),
    );
    const providerValues = Object.freeze(Object.fromEntries(
        upsertInsertProperties(metadata).map(property => [
            property.propertyName,
            cloneSnapshotValue(toBoundPropertyValue(
                values[property.propertyName],
                property,
                metadata.entityName,
            )),
        ]),
    ));
    return { entity, values: Object.freeze(values), providerValues };
}
