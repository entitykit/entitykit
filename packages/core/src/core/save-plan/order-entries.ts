import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { EntityConstructor } from '../../types';
import { findPrincipalEntry } from './find-principal-entry';
import { addOneToOneDisplacementEdges } from './one-to-one-ordering';
import type { ChangeTracker } from '../../tracking/change-tracker';
import type { Model } from '../../model/model';
import { stableTopologicalOrder } from './stable-topological-order';

/** Order dependencies, then unrelated modified, added, and deleted entries. */
export function orderSaveEntries(
    entries: readonly PersistedEntrySnapshot[],
    tracker: ChangeTracker,
    model: Model,
    trackedEntries: readonly PersistedEntrySnapshot[] = entries,
): PersistedEntrySnapshot[] {
    const outgoing: Map<
        PersistedEntrySnapshot,
        Set<PersistedEntrySnapshot>
    > = new Map();
    const incoming: Map<PersistedEntrySnapshot, number> = new Map();
    const originalIndex: Map<PersistedEntrySnapshot, number> = new Map();
    const entriesByEntity: Map<object, PersistedEntrySnapshot> = new Map();
    const entriesByType: Map<
        EntityConstructor<object>,
        PersistedEntrySnapshot[]
    > = new Map();

    entries.forEach((snapshot, index) => {
        outgoing.set(snapshot, new Set());
        incoming.set(snapshot, 0);
        originalIndex.set(snapshot, index);
    });
    trackedEntries.forEach(snapshot => {
        const { entry } = snapshot;
        entriesByEntity.set(entry.entity, snapshot);
        const typed = entriesByType.get(entry.metadata.ctor) ?? [];
        typed.push(snapshot);
        entriesByType.set(entry.metadata.ctor, typed);
    });

    const addEdge = (
        before: PersistedEntrySnapshot,
        after: PersistedEntrySnapshot,
    ): void => {
        if (before === after || outgoing.get(before)?.has(after)) {
            return;
        }
        outgoing.get(before)?.add(after);
        incoming.set(after, (incoming.get(after) ?? 0) + 1);
    };

    for (const dependent of entries) {
        const { entry } = dependent;
        for (const relationship of entry.metadata.relationships) {
            if (entry.state === EntityState.Deleted) {
                const principal = findPrincipalEntry(
                    relationship,
                    dependent,
                    'original',
                    tracker,
                    model,
                    entriesByType,
                    entriesByEntity,
                );
                if (principal?.state === EntityState.Deleted) {
                    addEdge(dependent, principal);
                }
                continue;
            }

            const principal = findPrincipalEntry(
                relationship,
                dependent,
                'current',
                tracker,
                model,
                entriesByType,
                entriesByEntity,
            );
            if (principal?.state === EntityState.Added) {
                addEdge(principal, dependent);
            }

            if (entry.state === EntityState.Modified) {
                const previousPrincipal = findPrincipalEntry(
                    relationship,
                    dependent,
                    'original',
                    tracker,
                    model,
                    entriesByType,
                    entriesByEntity,
                );
                if (previousPrincipal?.state === EntityState.Deleted) {
                    addEdge(dependent, previousPrincipal);
                }
            }
        }
    }

    addOneToOneDisplacementEdges(entries, addEdge);

    const compare = (
        left: PersistedEntrySnapshot,
        right: PersistedEntrySnapshot,
    ): number =>
        statePriority(left.state) - statePriority(right.state) ||
    (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
    return stableTopologicalOrder(entries, outgoing, incoming, compare);
}

function statePriority(state: EntityState): number {
    if (state === EntityState.Modified) {
        return 0;
    }
    if (state === EntityState.Added) {
        return 1;
    }
    return 2;
}
