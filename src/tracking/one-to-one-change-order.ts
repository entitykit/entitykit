import type { EntityEntry } from './entity-entry';
import type {
    OneToOneIntent,
    OneToOneIntentGroup,
} from './one-to-one-change-intent';

/** Apply occupied one-to-one chains from their terminal move backwards. */
export function orderOneToOneChanges(
    entries: ReadonlyArray<EntityEntry<object>>,
    groups: readonly OneToOneIntentGroup[],
): ReadonlyArray<EntityEntry<object>> {
    const included = new Set(entries);
    const outgoing = new Map(entries.map(entry => [
        entry, new Set<EntityEntry<object>>(),
    ]));
    const incoming = new Map(entries.map(entry => [entry, 0]));
    for (const { intents } of groups) {
        addIntentEdges(intents, included, outgoing, incoming);
    }
    return stableTopologicalOrder(entries, outgoing, incoming);
}

function addIntentEdges(
    intents: readonly OneToOneIntent[],
    included: ReadonlySet<EntityEntry<object>>,
    outgoing: Map<EntityEntry<object>, Set<EntityEntry<object>>>,
    incoming: Map<EntityEntry<object>, number>,
): void {
    const previousOwner: Map<
        EntityEntry<object>, OneToOneIntent
    > = new Map();
    for (const intent of intents) {
        if (intent.previous) previousOwner.set(intent.previous, intent);
    }
    for (const incomingIntent of intents) {
        if (!incomingIntent.changed || !incomingIntent.desired) continue;
        const occupant = previousOwner.get(incomingIntent.desired);
        if (
            !occupant?.changed || occupant === incomingIntent ||
            occupant.desired === incomingIntent.desired ||
            !included.has(occupant.dependent) ||
            !included.has(incomingIntent.dependent)
        ) continue;
        const dependents = outgoing.get(occupant.dependent);
        if (!dependents?.has(incomingIntent.dependent)) {
            dependents?.add(incomingIntent.dependent);
            incoming.set(
                incomingIntent.dependent,
                (incoming.get(incomingIntent.dependent) ?? 0) + 1,
            );
        }
    }
}

function stableTopologicalOrder(
    entries: ReadonlyArray<EntityEntry<object>>,
    outgoing: ReadonlyMap<EntityEntry<object>, ReadonlySet<EntityEntry<object>>>,
    incoming: Map<EntityEntry<object>, number>,
): ReadonlyArray<EntityEntry<object>> {
    const index = new Map(entries.map((entry, position) => [entry, position]));
    const remaining = new Set(entries);
    const ordered: Array<EntityEntry<object>> = [];
    while (remaining.size > 0) {
        const ready = [...remaining]
            .filter(entry => (incoming.get(entry) ?? 0) === 0)
            .sort((left, right) =>
                (index.get(left) ?? 0) - (index.get(right) ?? 0));
        if (ready.length === 0) {
            throw new Error('One-to-one relationship changes contain a cycle.');
        }
        const next = ready[0];
        remaining.delete(next);
        ordered.push(next);
        for (const dependent of outgoing.get(next) ?? []) {
            incoming.set(dependent, (incoming.get(dependent) ?? 0) - 1);
        }
    }
    return ordered;
}
