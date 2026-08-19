import {
    ensureComplexPropertyPathFailureAtomic,
} from '../materialization/complex-property-path-write';
import type { EntityMetadata } from '../model/entity-metadata';
import { writeFailureAtomicProperty } from '../failure-atomic-property-write';
import type { RestorationScope } from '../restoration-scope';
import { snapshotPropertyValue } from './snapshot-value';
import { readPropertyPath } from '../model/property-value-access';

export function syncDatabaseVersions<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    values: Readonly<Record<string, unknown>>,
    restoration: RestorationScope,
): void {
    for (const property of metadata.properties) {
        if (!property.isVersion) {
            continue;
        }
        const value = snapshotPropertyValue(
            values[property.propertyName],
            property.converter,
        );
        const missingComplex = metadata.complexProperties.some(complex =>
            complex.propertyPath.length < property.propertyPath.length &&
            complex.propertyPath.every((segment, index) =>
                property.propertyPath[index] === segment) &&
            readPropertyPath(entity, complex.propertyPath) == null);
        if (missingComplex && (value === null || value === undefined)) {
            continue;
        }
        if (value !== null && value !== undefined) {
            ensureComplexPropertyPathFailureAtomic(
                metadata,
                entity,
                property.propertyPath,
                restoration,
            );
        }
        writeFailureAtomicProperty({
            entity,
            property,
            value,
            scope: restoration,
            context: `${metadata.entityName}.${property.propertyName}`,
        });
    }
}
