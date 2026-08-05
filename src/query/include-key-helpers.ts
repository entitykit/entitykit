import type { EntityMetadata } from '../model/entity-metadata';
import {
    encodeIdentityTuple,
} from '../model/identity-value';
import {
    readStoreValue,
    type StoreValueReader,
} from '../storage/store-value-reader';

export function uniqueValues(values: readonly unknown[]): unknown[] {
    const seen: Set<string> = new Set();
    const unique: unknown[] = [];

    for (const value of values) {
        const key = lookupKey(value);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(value);
        }
    }

    return unique;
}

/**
 * Composite-safe lookup key for a tuple of values.
 *
 * Parts are escaped so that tuples such as ("a|b", 1) and ("a", 2) cannot
 * produce the same key.
 */
export function tupleLookupKey(values: readonly unknown[]): string {
    return encodeIdentityTuple(values);
}

export function uniqueTuples(
    tuples: ReadonlyArray<readonly unknown[]>,
): Array<readonly unknown[]> {
    const seen: Set<string> = new Set();
    const unique: Array<readonly unknown[]> = [];

    for (const tuple of tuples) {
        const key = tupleLookupKey(tuple);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(tuple);
        }
    }

    return unique;
}

/** A relationship end is unset when any part of its key is missing. */
export function isCompleteTuple(values: readonly unknown[]): boolean {
    return values.every(value => value !== undefined && value !== null);
}

export function lookupKey(value: unknown): string {
    return encodeIdentityTuple([value]);
}

/** Convert one raw key column value from a join row into its model form. */
export function readKeyColumn(
    metadata: EntityMetadata,
    columnIndex: number,
    value: unknown,
    valueReader?: StoreValueReader,
): unknown {
    return readStoreValue(
        value,
        metadata.keyPropertiesMetadata[columnIndex],
        valueReader,
        metadata.entityName,
    );
}
