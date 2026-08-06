import type { EntityEntry } from './entity-entry';
import { cloneEntityValues } from './entity-entry-snapshot';
import { EntityState } from './entity-state';
import { captureNavigationSnapshotValues } from './navigation-snapshot';
import type { PersistedEntrySnapshot } from './persisted-entry-snapshot';
import type { TrackedIdentityMap } from './tracked-identity-map';
import {
    TrackedAcceptanceJournal,
    type TrackedAcceptance,
} from './tracked-acceptance-journal';
import { assertNoUnresolvedGeneratedIdentities } from './temporary-generated-identity';
import { trackingIdentityKeyForEntry } from './tracking-identity-key';

export class ChangeTrackerAcceptance {
    constructor(
        private readonly entries: () => ReadonlyArray<EntityEntry<object>>,
        private readonly isTracked: (entry: EntityEntry<object>) => boolean,
        private readonly identities: TrackedIdentityMap,
        private readonly detach: (entity: object) => void,
        private readonly restore: (entry: EntityEntry<object>) => void,
        private readonly defer: (
            entries: ReadonlyArray<EntityEntry<object>>,
            identityKeys: readonly string[],
        ) => () => void,
        private readonly assertInvariant: () => void,
    ) {}

    public acceptAll(): void {
        const entries = this.entries();
        assertNoUnresolvedGeneratedIdentities(entries);
        this.identities.prepareAccept(
            entries,
            entry => trackingIdentityKeyForEntry(entry, entry.currentValues()),
        );
        for (const entry of entries) {
            if (entry.state === EntityState.Deleted) {
                this.detach(entry.entity);
                continue;
            }
            entry.acceptChanges();
        }
        this.assertInvariant();
    }

    public acceptPersisted(
        snapshots: readonly PersistedEntrySnapshot[],
    ): TrackedAcceptance {
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
                return trackingIdentityKeyForEntry(entry, persisted.values);
            },
            true,
        );
        const reservedIdentityKeys = new Set(
            checkpoints.map(checkpoint => checkpoint.identityKey),
        );
        for (const snapshot of tracked) {
            const identityKey = this.identities.keyFor(snapshot.entry);
            if (identityKey !== undefined) {
                reservedIdentityKeys.add(identityKey);
            }
        }
        const uncommitted = new TrackedAcceptanceJournal(
            checkpoints,
            this.identities,
            this.restore,
            () => undefined,
            this.assertInvariant,
        );
        try {
            for (const snapshot of tracked) {
                this.acceptSnapshot(snapshot);
            }
            this.assertInvariant();
        } catch (error) {
            uncommitted.rollback();
            throw error;
        }
        return new TrackedAcceptanceJournal(
            checkpoints,
            this.identities,
            this.restore,
            this.defer(
                tracked.map(snapshot => snapshot.entry),
                [...reservedIdentityKeys],
            ),
            this.assertInvariant,
        );
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

        entry.acceptPersistedValues(
            snapshot.values,
            snapshot.navigations,
            pendingState !== snapshot.state
                ? pendingState
                : EntityState.Unchanged,
        );
        if (pendingState !== snapshot.state) {
            return;
        }
        entry.detectChanges();
    }
}
