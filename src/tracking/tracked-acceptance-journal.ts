import type { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import type { NavigationSnapshotValues } from './navigation-snapshot';
import type { TrackedIdentityMap } from './tracked-identity-map';

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
    ) {}

    public commit(): void {
        if (!this.pending) return;
        this.pending = false;
        this.release();
    }

    public rollback(): void {
        if (!this.pending) return;
        this.pending = false;
        this.release();
        for (const checkpoint of this.checkpoints) {
            checkpoint.entry.restoreTrackedValues(
                checkpoint.originalValues,
                checkpoint.navigations,
                checkpoint.state,
            );
            this.restoreEntry(checkpoint.entry);
        }
        this.identities.restoreKeys(this.checkpoints.map(checkpoint => ({
            entry: checkpoint.entry,
            key: checkpoint.identityKey,
        })));
    }
}
