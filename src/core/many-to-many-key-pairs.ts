import type { ManyToManyChange } from './many-to-many-change';
import type {
    CapturedRelationshipEndpoint,
    ManyToManyChangeValidator,
} from './many-to-many-change-validator';
import { encodeSaveIdentityTuple } from './save-key-values';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import type { PersistedValueLookup } from './save-plan-execution';
import { toBoundPropertyValue } from '../model/value-converter/store-value';

export interface CapturedManyToManyChange {
    readonly change: ManyToManyChange;
    readonly source: CapturedRelationshipEndpoint;
    readonly target: CapturedRelationshipEndpoint;
}

export function captureManyToManyChanges(
    changes: readonly ManyToManyChange[],
    validator: ManyToManyChangeValidator,
    snapshotsByEntity: ReadonlyMap<object, PersistedEntrySnapshot>,
): CapturedManyToManyChange[] {
    const endpoints: WeakMap<object, CapturedRelationshipEndpoint> = new WeakMap();
    return changes.map(change => ({
        change,
        source: validator.capturedEndpoint(
            change, 'source', snapshotsByEntity, endpoints,
        ),
        target: validator.capturedEndpoint(
            change, 'target', snapshotsByEntity, endpoints,
        ),
    }));
}

/** Keep only the last requested action for each concrete join-table row. */
export function coalesceManyToManyChanges(
    changes: readonly CapturedManyToManyChange[],
): CapturedManyToManyChange[] {
    const latest: Map<string, CapturedManyToManyChange> = new Map();

    for (const captured of changes) {
        const { change } = captured;
        const relationship = captured.change.relationship;
        const key = JSON.stringify([
            change.sourceMetadata.entityName,
            String(relationship.navigationProperty),
            relationship.joinSchemaName ?? '',
            relationship.joinTableName,
            relationship.sourceForeignKeyColumns,
            relationship.targetForeignKeyColumns,
            captured.source.encodedIdentity,
            captured.target.encodedIdentity,
        ]);
        latest.set(key, captured);
    }

    return [...latest.values()];
}

export function buildValidatedManyToManyPairs(
    group: readonly CapturedManyToManyChange[],
    persistedValue?: PersistedValueLookup,
): Array<readonly [unknown, unknown]> {
    const seenPairs: Set<string> = new Set();
    const pairs: Array<readonly [unknown, unknown]> = [];

    for (const captured of group) {
        const sourceKey = resolvedProviderKeyValues(
            captured.source,
            persistedValue,
        );
        const targetKey = resolvedProviderKeyValues(
            captured.target,
            persistedValue,
        );
        const pairKey = encodeSaveIdentityTuple([
            sourceKey,
            targetKey,
        ]);

        if (!seenPairs.has(pairKey)) {
            seenPairs.add(pairKey);
            pairs.push([sourceKey, targetKey]);
        }
    }

    return pairs;
}

function resolvedProviderKeyValues(
    endpoint: CapturedRelationshipEndpoint,
    persistedValue?: PersistedValueLookup,
): readonly unknown[] {
    return endpoint.metadata.keyPropertiesMetadata.map((property, index) => {
        const generated = persistedValue?.(
            endpoint.entity,
            property.propertyName,
        );
        if (generated) {
            return toBoundPropertyValue(
                generated.persistedValue,
                property,
                endpoint.metadata.entityName,
            );
        }
        if (
            persistedValue !== undefined &&
            endpoint.temporaryPropertyNames.has(property.propertyName)
        ) {
            throw new Error(
                `Many-to-many endpoint '${endpoint.metadata.entityName}' still has a temporary generated key '${property.propertyName}' after its insert.`,
            );
        }
        return endpoint.providerKeyValues[index];
    });
}
