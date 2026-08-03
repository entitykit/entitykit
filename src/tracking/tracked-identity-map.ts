import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';

/**
 * Identity keys as they were registered, independent of mutable entity fields.
 *
 * Existing keys cannot change. Added entities may receive their final key
 * before acceptance, so acceptance rekeys them atomically after checking the
 * complete final identity set for collisions.
 */
export class TrackedIdentityMap {
    private readonly entries: Map<string, EntityEntry<object>> = new Map();
    private readonly keys: WeakMap<EntityEntry<object>, string> = new WeakMap();

    public get(key: string): EntityEntry<object> | undefined {
        return this.entries.get(key);
    }

    public add(key: string, entry: EntityEntry<object>): void {
        this.entries.set(key, entry);
        this.keys.set(entry, key);
    }

    public remove(entry: EntityEntry<object>): void {
        const key = this.keys.get(entry);
        if (key !== undefined && this.entries.get(key) === entry) {
            this.entries.delete(key);
        }
        this.keys.delete(entry);
    }

    public keyFor(entry: EntityEntry<object>): string | undefined {
        return this.keys.get(entry);
    }

    public restoreKeys(
        checkpoints: ReadonlyArray<{
            readonly entry: EntityEntry<object>;
            readonly key: string;
        }>,
    ): void {
        for (const checkpoint of checkpoints) {
            this.remove(checkpoint.entry);
        }
        for (const checkpoint of checkpoints) {
            this.entries.set(checkpoint.key, checkpoint.entry);
            this.keys.set(checkpoint.entry, checkpoint.key);
        }
    }

    public prepareAccept(
        entries: ReadonlyArray<EntityEntry<object>>,
        identityKey: (entry: EntityEntry<object>) => string = entry =>
            entry.metadata.createIdentityKey(entry.entity),
    ): void {
        const acceptedEntries = new Set(entries);
        const finalKeys: Map<string, EntityEntry<object>> = new Map();
        const rekeys: Array<{
            readonly entry: EntityEntry<object>;
            readonly previous: string;
            readonly next: string;
        }> = [];

        for (const entry of entries) {
            if (entry.state === EntityState.Deleted) {
                continue;
            }

            const previous = this.keys.get(entry);
            const next = identityKey(entry);
            if (previous === undefined) {
                throw new Error('Tracked entity has no registered identity.');
            }
            if (previous !== next && entry.state !== EntityState.Added) {
                throw new Error(
                    `Primary key changes are not supported for entity '${entry.metadata.entityName}'.`,
                );
            }

            const collision = finalKeys.get(next);
            if (collision && collision !== entry) {
                throw new Error(
                    `An instance of '${entry.metadata.entityName}' with key '${String(entry.keyValue)}' is already tracked.`,
                );
            }
            const trackedCollision = this.entries.get(next);
            if (
                trackedCollision &&
                trackedCollision !== entry &&
                !acceptedEntries.has(trackedCollision)
            ) {
                throw new Error(
                    `An instance of '${entry.metadata.entityName}' with key '${String(entry.keyValue)}' is already tracked.`,
                );
            }
            finalKeys.set(next, entry);
            if (previous !== next) {
                rekeys.push({ entry, previous, next });
            }
        }

        for (const rekey of rekeys) {
            if (this.entries.get(rekey.previous) === rekey.entry) {
                this.entries.delete(rekey.previous);
            }
        }
        for (const rekey of rekeys) {
            this.entries.set(rekey.next, rekey.entry);
            this.keys.set(rekey.entry, rekey.next);
        }
    }

    public clear(): void {
        this.entries.clear();
    }
}
