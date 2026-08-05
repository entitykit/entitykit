import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import type { NavigationSnapshotValues } from './navigation-snapshot';
import type { TrackedIdentityMap } from './tracked-identity-map';
import { clearTemporaryGeneratedIdentity } from './temporary-generated-identity';

export interface TrackedAcceptance {
    commit(): void;
    rollback(): void;
}

export interface AcceptanceCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly state: EntityState;
    readonly originalValues: Record<string, unknown>;
    readonly navigations: NavigationSnapshotValues;
    readonly identityKey: string;
}

export class TrackedAcceptanceJournal implements TrackedAcceptance {
    private pending = true;

    constructor(
        private readonly checkpoints: readonly AcceptanceCheckpoint[],
        private readonly identities: TrackedIdentityMap,
        private readonly restoreEntry: (entry: EntityEntry<object>) => void,
        private readonly release: () => void,
        private readonly assertInvariant: () => void,
    ) {}

    public commit(): void {
        if (!this.pending) return;
        this.pending = false;
        for (const checkpoint of this.checkpoints) {
            if (checkpoint.state === EntityState.Added) {
                clearTemporaryGeneratedIdentity(checkpoint.entry);
            }
        }
        this.release();
    }

    public rollback(): void {
        if (!this.pending) return;
        this.pending = false;
        const identityCheckpoints = this.checkpoints.map(checkpoint => ({
            entry: checkpoint.entry,
            key: checkpoint.identityKey,
        }));
        try {
            this.identities.assertCanRestoreKeys(identityCheckpoints);
            for (const checkpoint of this.checkpoints) {
                checkpoint.entry.restoreTrackedValues(
                    checkpoint.originalValues,
                    checkpoint.navigations,
                    checkpoint.state,
                );
                this.restoreEntry(checkpoint.entry);
            }
            this.identities.restoreKeys(identityCheckpoints);
            this.assertInvariant();
        } finally {
            this.release();
        }
    }
}
