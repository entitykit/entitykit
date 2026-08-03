import type { EntityEntry } from './entity-entry';

export interface IdentityCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly key: string;
}

export function assertIdentityKeysRestorable(
    entries: ReadonlyMap<string, EntityEntry<object>>,
    checkpoints: readonly IdentityCheckpoint[],
): void {
    const restoring = new Set(checkpoints.map(checkpoint => checkpoint.entry));
    for (const checkpoint of checkpoints) {
        const collision = entries.get(checkpoint.key);
        if (
            collision &&
            collision !== checkpoint.entry &&
            !restoring.has(collision)
        ) {
            throw identityCollision(checkpoint.entry);
        }
    }
}

export function assertTrackedIdentityConsistency(
    entries: ReadonlyMap<string, EntityEntry<object>>,
    keys: WeakMap<EntityEntry<object>, string>,
    trackedEntries: ReadonlySet<EntityEntry<object>>,
): void {
    for (const entry of trackedEntries) {
        const key = keys.get(entry);
        if (key === undefined || entries.get(key) !== entry) {
            throw new Error(
                `Identity-map invariant failed for tracked '${entry.metadata.entityName}'.`,
            );
        }
    }
    for (const entry of entries.values()) {
        if (!trackedEntries.has(entry)) {
            throw new Error(
                `Identity-map invariant retained detached '${entry.metadata.entityName}'.`,
            );
        }
    }
    assertIdentityMapConsistency(entries, keys);
}

export function assertIdentityMapConsistency(
    entries: ReadonlyMap<string, EntityEntry<object>>,
    keys: WeakMap<EntityEntry<object>, string>,
): void {
    for (const [key, entry] of entries) {
        if (keys.get(entry) !== key) {
            throw new Error(
                `Identity-map invariant failed for '${entry.metadata.entityName}'.`,
            );
        }
    }
}

export function identityCollision(entry: EntityEntry<object>): Error {
    return new Error(
        `An instance of '${entry.metadata.entityName}' with key '${String(entry.keyValue)}' is already tracked.`,
    );
}
