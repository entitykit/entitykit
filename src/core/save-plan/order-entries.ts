import type { EntityEntry } from '../../tracking/entity-entry';
import { EntityState } from '../../tracking/entity-state';
import type { EntityConstructor } from '../../types';
import { findPrincipalEntry } from './find-principal-entry';

/** Order dependencies, then unrelated modified, added, and deleted entries. */
export function orderSaveEntries(
    entries: ReadonlyArray<EntityEntry<object>>,
): Array<EntityEntry<object>> {
    const outgoing: Map<EntityEntry<object>, Set<EntityEntry<object>>> = new Map();
    const incoming: Map<EntityEntry<object>, number> = new Map();
    const originalIndex: Map<EntityEntry<object>, number> = new Map();
    const entriesByEntity: Map<object, EntityEntry<object>> = new Map();
    const entriesByType: Map<
        EntityConstructor<object>,
        Array<EntityEntry<object>>
    > = new Map();

    entries.forEach((entry, index) => {
        outgoing.set(entry, new Set());
        incoming.set(entry, 0);
        originalIndex.set(entry, index);
        entriesByEntity.set(entry.entity, entry);
        const typed = entriesByType.get(entry.metadata.ctor) ?? [];
        typed.push(entry);
        entriesByType.set(entry.metadata.ctor, typed);
    });

    const addEdge = (
        before: EntityEntry<object>,
        after: EntityEntry<object>,
    ): void => {
        if (before === after || outgoing.get(before)?.has(after)) {
            return;
        }
        outgoing.get(before)?.add(after);
        incoming.set(after, (incoming.get(after) ?? 0) + 1);
    };

    for (const dependent of entries) {
        for (const relationship of dependent.metadata.relationships) {
            if (dependent.state === EntityState.Deleted) {
                const principal = findPrincipalEntry(
                    relationship,
                    dependent.originalValues,
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
                dependent.entity as Record<string, unknown>,
                entriesByType,
                entriesByEntity,
            );
            if (principal?.state === EntityState.Added) {
                addEdge(principal, dependent);
            }

            if (dependent.state === EntityState.Modified) {
                const previousPrincipal = findPrincipalEntry(
                    relationship,
                    dependent.originalValues,
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
    entries: ReadonlyArray<EntityEntry<object>>,
    outgoing: ReadonlyMap<EntityEntry<object>, ReadonlySet<EntityEntry<object>>>,
    incoming: Map<EntityEntry<object>, number>,
    originalIndex: ReadonlyMap<EntityEntry<object>, number>,
): Array<EntityEntry<object>> {
    const remaining = new Set(entries);
    const ordered: Array<EntityEntry<object>> = [];
    const compare = (left: EntityEntry<object>, right: EntityEntry<object>): number =>
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
