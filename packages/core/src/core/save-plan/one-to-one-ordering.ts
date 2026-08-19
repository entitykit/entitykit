import { RelationshipCardinality } from '../../model/relationship-metadata';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import { snapshotValuesEqual } from '../../tracking/snapshot-value-equality';

export function addOneToOneDisplacementEdges(
    entries: readonly PersistedEntrySnapshot[],
    addEdge: (
        before: PersistedEntrySnapshot,
        after: PersistedEntrySnapshot,
    ) => void,
): void {
    for (const incoming of entries) {
        if (incoming.state === EntityState.Deleted) continue;
        for (const relationship of incoming.entry.metadata.relationships) {
            if (relationship.cardinality !== RelationshipCardinality.OneToOne) {
                continue;
            }
            for (const occupant of entries) {
                if (
                    occupant === incoming ||
                    occupant.entry.metadata !== incoming.entry.metadata
                ) continue;
                const occupiedTarget = relationship.foreignKeyProperties.every(
                    property =>
                        snapshotValuesEqual(
                            snapshotValue(incoming, property, false),
                            snapshotValue(occupant, property, true),
                        ));
                const occupantVacates = occupant.state === EntityState.Deleted ||
                    relationship.foreignKeyProperties.some(property =>
                        !snapshotValuesEqual(
                            snapshotValue(occupant, property, false),
                            snapshotValue(occupant, property, true),
                        ));
                if (occupiedTarget && occupantVacates) {
                    addEdge(occupant, incoming);
                }
            }
        }
    }
}

function snapshotValue(
    snapshot: PersistedEntrySnapshot,
    property: string,
    original: boolean,
): unknown {
    const bound = original
        ? snapshot.originalBoundValues
        : snapshot.boundValues;
    if (Object.prototype.hasOwnProperty.call(bound, property)) {
        return bound[property];
    }
    return original
        ? snapshot.entry.originalValues[property]
        : snapshot.values[property];
}
