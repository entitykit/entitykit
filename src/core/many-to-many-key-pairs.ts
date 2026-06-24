import type { ManyToManyChange } from './many-to-many-change';
import type { ManyToManyChangeValidator } from './many-to-many-change-validator';
import {
    formatSaveIdentityValue,
    toProviderKeyValues,
} from './save-key-values';

/** Keep only the last requested action for each concrete join-table row. */
export function coalesceManyToManyChanges(
    changes: readonly ManyToManyChange[],
    validator: ManyToManyChangeValidator,
): ManyToManyChange[] {
    const endpointKeys: WeakMap<object, readonly unknown[]> = new WeakMap();
    const latest: Map<string, ManyToManyChange> = new Map();

    for (const change of changes) {
        const sourceKey = toProviderKeyValues(
            validator.validatedKey(change, 'source', endpointKeys),
            change.sourceMetadata,
        );
        const targetKey = toProviderKeyValues(
            validator.validatedKey(change, 'target', endpointKeys),
            change.targetMetadata,
        );
        const relationship = change.relationship;
        const key = JSON.stringify([
            change.sourceMetadata.entityName,
            String(relationship.navigationProperty),
            relationship.joinSchemaName ?? '',
            relationship.joinTableName,
            relationship.sourceForeignKeyColumns,
            relationship.targetForeignKeyColumns,
            formatSaveIdentityValue(sourceKey),
            formatSaveIdentityValue(targetKey),
        ]);
        latest.set(key, change);
    }

    return [...latest.values()];
}

export function buildValidatedManyToManyPairs(
    group: readonly ManyToManyChange[],
    validator: ManyToManyChangeValidator,
): Array<readonly [unknown, unknown]> {
    const endpointKeys: WeakMap<object, readonly unknown[]> = new WeakMap();
    const seenPairs: Set<string> = new Set();
    const pairs: Array<readonly [unknown, unknown]> = [];

    for (const change of group) {
        const sourceKey = toProviderKeyValues(
            validator.validatedKey(change, 'source', endpointKeys),
            change.sourceMetadata,
        );
        const targetKey = toProviderKeyValues(
            validator.validatedKey(change, 'target', endpointKeys),
            change.targetMetadata,
        );
        const pairKey = JSON.stringify([
            formatSaveIdentityValue(sourceKey),
            formatSaveIdentityValue(targetKey),
        ]);

        if (!seenPairs.has(pairKey)) {
            seenPairs.add(pairKey);
            pairs.push([sourceKey, targetKey]);
        }
    }

    return pairs;
}
