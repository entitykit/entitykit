import type { ChangeTracker } from './change-tracker';
import type { ChangeTrackerRegistry } from './change-tracker-registry';
import type { EntityEntry } from './entity-entry';

interface RelationshipDetectionRegistryState {
    readonly registry: ChangeTrackerRegistry;
    readonly notifyDetached: (entity: object) => (() => void) | undefined;
    detached?: Set<object>;
}

const registries: WeakMap<
    ChangeTracker, RelationshipDetectionRegistryState
> = new WeakMap();

export function registerRelationshipDetectionRegistry(
    tracker: ChangeTracker,
    registry: ChangeTrackerRegistry,
    notifyDetached: (entity: object) => (() => void) | undefined,
): void {
    registries.set(tracker, { registry, notifyDetached });
}

export function relationshipDetectionIdentityKey(
    tracker: ChangeTracker,
    entry: EntityEntry<object>,
): string | undefined {
    return requireState(tracker).registry.identities.keyFor(entry);
}

export function beginRelationshipDetectionDetachScope(
    tracker: ChangeTracker,
): { commit(): void; rollback(): void } {
    const state = requireState(tracker);
    const detached: Set<object> = new Set();
    state.detached = detached;
    return {
        commit(): void {
            state.detached = undefined;
            const rollbacks: Array<() => void> = [];
            try {
                for (const entity of detached) {
                    const rollback = state.notifyDetached(entity);
                    if (rollback) rollbacks.push(rollback);
                }
            } catch (error) {
                for (const rollback of rollbacks.reverse()) rollback();
                throw error;
            }
        },
        rollback(): void {
            state.detached = undefined;
        },
    };
}

export function detachRelationshipEntry(
    tracker: ChangeTracker,
    entity: object,
): void {
    const state = requireState(tracker);
    const detached = state.registry.detach(entity);
    if (!detached) return;
    if (state.detached) state.detached.add(entity);
    else state.notifyDetached(entity);
}

export function restoreRelationshipDetectionEntries(
    tracker: ChangeTracker,
    checkpoints: ReadonlyArray<{
        readonly entry: EntityEntry<object>;
        readonly identityKey: string;
    }>,
): void {
    const registry = requireState(tracker).registry;
    for (const checkpoint of checkpoints) registry.restore(checkpoint.entry);
    registry.identities.restoreKeys(checkpoints.map(checkpoint => ({
        entry: checkpoint.entry,
        key: checkpoint.identityKey,
    })));
    registry.assertInvariant();
}

function requireState(tracker: ChangeTracker): RelationshipDetectionRegistryState {
    const state = registries.get(tracker);
    if (!state) throw new Error('Change tracker registry is unavailable.');
    return state;
}
