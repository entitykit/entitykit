import type { EntityMetadata } from '../model/entity-metadata';
import { readStoreValue, type StoreValueReader } from '../storage/store-value-reader';

/** Read the model tenant component used by identity resolution from one row. */
export function readTrackingTenantFromRow<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    row: Record<string, unknown>,
    valueReader?: StoreValueReader,
): unknown {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || metadata.keyProperties.includes(tenantProperty)) {
        return undefined;
    }
    const property = metadata.getProperty(tenantProperty);
    return readStoreValue(
        row[property.columnName],
        property,
        valueReader,
        metadata.entityName,
    );
}
