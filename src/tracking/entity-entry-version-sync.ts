import { ensureComplexPropertyPath } from '../materialization/complex-value-materializer';
import type { EntityMetadata } from '../model/entity-metadata';
import { writePropertyValue } from '../model/property-value-access';
import { snapshotPropertyValue } from './snapshot-value';

export function syncDatabaseVersions<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    values: Readonly<Record<string, unknown>>,
): void {
    for (const property of metadata.properties) {
        if (!property.isVersion) {
            continue;
        }
        const value = snapshotPropertyValue(
            values[property.propertyName],
            property.converter,
        );
        if (value !== null && value !== undefined) {
            ensureComplexPropertyPath(
                metadata,
                entity,
                property.propertyPath,
            );
        }
        writePropertyValue(entity, property, value);
    }
}
