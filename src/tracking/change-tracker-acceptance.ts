import type { EntityEntry } from './entity-entry';
import { cloneEntityValues } from './entity-entry-snapshot';
import { EntityState } from './entity-state';
import {
    captureNavigationSnapshotValues,
} from './navigation-snapshot';
import type { PersistedEntrySnapshot } from './persisted-entry-snapshot';
import type { TrackedIdentityMap } from './tracked-identity-map';

export class ChangeTrackerAcceptance {
    constructor(
        private readonly entries: () => ReadonlyArray<EntityEntry<object>>,
        private readonly isTracked: (entry: EntityEntry<object>) => boolean,
        private readonly identities: TrackedIdentityMap,
        private readonly detach: (entity: object) => void,
        private readonly restore: (entry: EntityEntry<object>) => void,
    ) {}

    public acceptAll(): void {
        const entries = this.entries();
        this.identities.prepareAccept(entries);
        for (const entry of entries) {
            if (entry.state === EntityState.Deleted) {
                this.detach(entry.entity);
                continue;
            }

            entry.acceptChanges();
        }
    }

    public acceptPersisted(
        snapshots: readonly PersistedEntrySnapshot[],
    ): () => void {
        const tracked = snapshots.filter(snapshot =>
            this.isTracked(snapshot.entry));
        const checkpoints = tracked.map(snapshot => {
            const identityKey = this.identities.keyFor(snapshot.entry);
            if (identityKey === undefined) {
                throw new Error('Tracked entity has no registered identity.');
            }
            return {
                entry: snapshot.entry,
                state: snapshot.entry.state,
                originalValues: cloneEntityValues(
                    snapshot.entry.metadata,
                    { ...snapshot.entry.originalValues },
                ),
                navigations: captureNavigationSnapshotValues(snapshot.entry),
                identityKey,
            };
        });
        const persistedByEntry = new Map(tracked.map(snapshot => [
            snapshot.entry,
            snapshot,
        ]));
        this.identities.prepareAccept(
            tracked
                .filter(snapshot => snapshot.state !== EntityState.Deleted)
                .map(snapshot => snapshot.entry),
            entry => {
                const persisted = persistedByEntry.get(entry);
                if (!persisted) {
                    throw new Error('Persisted identity snapshot is unavailable.');
                }
                return entry.metadata.createIdentityKeyFromValues(
                    entry.metadata.keyProperties.map(propertyName =>
                        persisted.values[propertyName]),
                );
            },
        );

        for (const snapshot of tracked) {
            this.acceptSnapshot(snapshot);
        }

        return this.createRollback(checkpoints);
    }

    private acceptSnapshot(snapshot: PersistedEntrySnapshot): void {
        const entry = snapshot.entry;
        const pendingState = entry.state;
        if (
            snapshot.state === EntityState.Deleted &&
            pendingState === EntityState.Deleted
        ) {
            this.detach(entry.entity);
            return;
        }
        if (snapshot.state === EntityState.Deleted) {
            return;
        }

        entry.acceptPersistedValues(snapshot.values, snapshot.navigations);
        if (pendingState !== snapshot.state) {
            entry.state = pendingState;
        } else {
            entry.detectChanges();
        }
    }

    private createRollback(checkpoints: readonly AcceptanceCheckpoint[]): () => void {
        let pending = true;
        return () => {
            if (!pending) {
                return;
            }
            pending = false;
            for (const checkpoint of checkpoints) {
                checkpoint.entry.restoreTrackedValues(
                    checkpoint.originalValues,
                    checkpoint.navigations,
                    checkpoint.state,
                );
                this.restore(checkpoint.entry);
            }
            this.identities.restoreKeys(checkpoints.map(checkpoint => ({
                entry: checkpoint.entry,
                key: checkpoint.identityKey,
            })));
        };
    }
}

interface AcceptanceCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly state: EntityState;
    readonly originalValues: Record<string, unknown>;
    readonly navigations: ReturnType<typeof captureNavigationSnapshotValues>;
    readonly identityKey: string;
}
