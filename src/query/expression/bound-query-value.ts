import type { PropertyMetadata } from '../../model/property-metadata';
import { toBoundPropertyValue } from '../../model/value-converter/store-value';
import { cloneSnapshotValue } from '../../tracking/snapshot-value-clone';

/** Internal predicate operand that is already normalized for SQL binding. */
export class BoundQueryValue {
    constructor(public readonly value: unknown) {}
}

export function boundQueryValue(value: unknown): BoundQueryValue {
    return new BoundQueryValue(cloneSnapshotValue(value));
}

/** Bind ordinary model operands while preserving captured provider facts. */
export function toBoundQueryPropertyValue(
    value: unknown,
    property: PropertyMetadata,
    entityName: string,
): unknown {
    return value instanceof BoundQueryValue
        ? cloneSnapshotValue(value.value)
        : toBoundPropertyValue(value, property, entityName);
}
