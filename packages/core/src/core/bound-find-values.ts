import type { EntityMetadata } from '../model/entity-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import {
    boundQueryValue,
    type BoundQueryValue,
} from '../query/expression/bound-query-value';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';
import type { QueryFilterOperation } from './query-filter-operation';

export interface BoundFindValues {
    readonly byProperty: Readonly<Record<string, unknown>>;
    readonly predicates: readonly BoundQueryValue[];
}

/** Capture one immutable key and tenant provider tuple for a complete find. */
export function captureBoundFindValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    keyValues: readonly unknown[],
    operation: QueryFilterOperation,
): BoundFindValues {
    const byProperty: Record<string, unknown> = {};
    const predicates = metadata.keyPropertiesMetadata.map((property, index) => {
        const bound = cloneSnapshotValue(toBoundPropertyValue(
            keyValues[index],
            property,
            metadata.entityName,
        ));
        byProperty[property.propertyName] = bound;
        return boundQueryValue(bound);
    });
    const tenantProperty = metadata.tenantKeyProperty;
    if (
        tenantProperty &&
        !metadata.keyProperties.includes(tenantProperty) &&
        !operation.allowsCrossTenantAccess
    ) {
        byProperty[tenantProperty] = cloneSnapshotValue(
            operation.boundTenantFor(metadata)?.value,
        );
    }
    return { byProperty, predicates };
}
