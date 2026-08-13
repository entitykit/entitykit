import { RelationshipCardinality } from '../../model/relationship-metadata';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import { snapshotValuesEqual } from '../../tracking/snapshot-value-equality';

export function oneToOneDisplacementDeletes(
    pending: readonly PersistedEntrySnapshot[],
): ReadonlySet<object> {
    const displaced: Set<object> = new Set();
    for (const incoming of pending) {
        if (incoming.state === EntityState.Deleted) continue;
        for (const relationship of incoming.entry.metadata.relationships) {
            if (relationship.cardinality !== RelationshipCardinality.OneToOne) {
                continue;
            }
            const occupant = pending.find(candidate =>
                candidate !== incoming &&
                candidate.state === EntityState.Deleted &&
                candidate.entry.metadata === incoming.entry.metadata &&
                relationship.foreignKeyProperties.every(property =>
                    snapshotValuesEqual(
                        finalValue(incoming, property),
                        originalValue(candidate, property),
                    )),
            );
            if (occupant) displaced.add(occupant.entry.entity);
        }
    }
    return displaced;
}

function finalValue(
    snapshot: PersistedEntrySnapshot,
    property: string,
): unknown {
    return Object.prototype.hasOwnProperty.call(snapshot.boundValues, property)
        ? snapshot.boundValues[property]
        : snapshot.values[property];
}

function originalValue(
    snapshot: PersistedEntrySnapshot,
    property: string,
): unknown {
    return Object.prototype.hasOwnProperty.call(
        snapshot.originalBoundValues,
        property,
    )
        ? snapshot.originalBoundValues[property]
        : snapshot.entry.originalValues[property];
}
