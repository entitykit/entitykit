import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { EntityConstructor } from '../../types';
import { findPrincipalEntry } from './find-principal-entry';

/** Order dependencies, then unrelated modified, added, and deleted entries. */
export function orderSaveEntries(
    entries: readonly PersistedEntrySnapshot[],
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
        const { entry } = snapshot;
        outgoing.set(snapshot, new Set());
        incoming.set(snapshot, 0);
        originalIndex.set(snapshot, index);
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
                    entry.originalValues,
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
                {
                    ...dependent.values,
                    ...dependent.relationshipValues,
                },
                entriesByType,
                entriesByEntity,
            );
            if (principal?.state === EntityState.Added) {
                addEdge(principal, dependent);
            }

            if (entry.state === EntityState.Modified) {
                const previousPrincipal = findPrincipalEntry(
                    relationship,
                    entry.originalValues,
                    entriesByType,
                    entriesByEntity,
                );
                if (previousPrincipal?.state === EntityState.Deleted) {
                    addEdge(dependent, previousPrincipal);
                }
            }
        }
    }

    return stableTopologicalOrder(entries, outgoing, incoming, originalIndex);
}

function stableTopologicalOrder(
    entries: readonly PersistedEntrySnapshot[],
    outgoing: ReadonlyMap<
        PersistedEntrySnapshot,
        ReadonlySet<PersistedEntrySnapshot>
    >,
    incoming: Map<PersistedEntrySnapshot, number>,
    originalIndex: ReadonlyMap<PersistedEntrySnapshot, number>,
): PersistedEntrySnapshot[] {
    const remaining = new Set(entries);
    const ordered: PersistedEntrySnapshot[] = [];
    const compare = (
        left: PersistedEntrySnapshot,
        right: PersistedEntrySnapshot,
    ): number =>
        statePriority(left.state) - statePriority(right.state) ||
    (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);

    while (remaining.size > 0) {
        const ready = [...remaining]
            .filter(entry => (incoming.get(entry) ?? 0) === 0)
            .sort(compare);
        // Cyclic graphs have no ready node. Break the cycle deterministically and
        // let the provider enforce any irreducible constraint.
        const next = ready[0] ?? [...remaining].sort(compare)[0];
        remaining.delete(next);
        ordered.push(next);
        for (const dependent of outgoing.get(next) ?? []) {
            incoming.set(dependent, (incoming.get(dependent) ?? 0) - 1);
        }
    }

    return ordered;
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
