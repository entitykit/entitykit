import type { EntityMetadata } from '../model/entity-metadata';
import { toProviderValue } from '../model/value-converter/store-value';
import { tupleLookupKey } from './include-key-helpers';

export function propertyTupleLookupKey<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    propertyNames: readonly string[],
    values: readonly unknown[],
): string {
    if (propertyNames.length !== values.length) {
        throw new Error('Property tuple names and values must have equal lengths.');
    }
    return tupleLookupKey(values.map((value, index) => {
        const propertyName = propertyNames[index];
        const property = metadata.getProperty(propertyName);
        return toProviderValue(
            value,
            property.converter,
            `${metadata.entityName}.${propertyName}`,
        );
    }));
}

export function uniquePropertyTuples<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    propertyNames: readonly string[],
    tuples: ReadonlyArray<readonly unknown[]>,
): Array<readonly unknown[]> {
    const seen: Set<string> = new Set();
    return tuples.filter(tuple => {
        const key = propertyTupleLookupKey(metadata, propertyNames, tuple);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export function uniquePropertyValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    propertyName: string,
    values: readonly unknown[],
): unknown[] {
    return uniquePropertyTuples(
        metadata,
        [propertyName],
        values.map(value => [value]),
    ).map(tuple => tuple[0]);
}
