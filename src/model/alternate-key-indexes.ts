import type { AlternateKeyMetadata } from './alternate-key-metadata';
import type { IndexMetadata } from './index-metadata';
import { orderedEqual } from '../collections/ordered-equality';

export function mergeAlternateKeyIndexes<TEntity extends object>(
    indexes: Array<IndexMetadata<TEntity>>,
    alternateKeys: ReadonlyArray<AlternateKeyMetadata<TEntity>>,
): Array<IndexMetadata<TEntity>> {
    for (const key of alternateKeys) {
        const existing = indexes.find(index =>
            isAlternateKeyBackingIndex(index, key.propertyNames));
        if (existing) {
            if (
                key.databaseName !== undefined &&
                existing.databaseName !== undefined &&
                key.databaseName !== existing.databaseName
            ) {
                throw new Error(
                    `Alternate key and unique index over (${key.propertyNames.join(', ')}) configure different database names.`,
                );
            }
            if (key.databaseName !== undefined && existing.databaseName === undefined) {
                indexes[indexes.indexOf(existing)] = {
                    ...existing,
                    databaseName: key.databaseName,
                };
            }
            continue;
        }
        indexes.push({
            propertyNames: [...key.propertyNames],
            isUnique: true,
            databaseName: key.databaseName,
        });
    }
    return indexes;
}

export function isAlternateKeyBackingIndex<TEntity extends object>(
    index: IndexMetadata<TEntity>,
    properties: readonly PropertyKey[],
): boolean {
    return index.isUnique &&
        index.filter === undefined &&
        !index.keyParts?.some(part => part.kind === 'expression') &&
        orderedEqual(index.propertyNames, properties);
}
