import type { ChangeTracker } from '../tracking/change-tracker';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import type { SaveTimeMutationLog } from './save-time-mutations';
import {
    rememberSaveTimeRelationshipWrites,
    reconcileSaveTimeRelationships,
} from './save-time-relationship-reconciliation';

export interface SaveTimeRelationshipChanges {
    readonly foreignKeys: ReadonlySet<string>;
    readonly navigations: ReadonlySet<string>;
}

/** Save-attempt state for framework-written relationship values. */
export class SaveTimeRelationshipState {
    private readonly properties: Map<object, Set<string>> = new Map();
    private acceptance: readonly PersistedEntrySnapshot[] = [];

    public reset(): void {
        this.properties.clear();
        this.acceptance = [];
    }

    public remember(
        snapshot: PersistedEntrySnapshot,
        tenantWritten: boolean,
    ): void {
        rememberSaveTimeRelationshipWrites(
            this.properties,
            snapshot,
            tenantWritten,
        );
    }

    public reconcile(
        tracker: ChangeTracker,
        mutations: SaveTimeMutationLog,
    ): ReadonlyMap<object, SaveTimeRelationshipChanges> {
        const navigations = reconcileSaveTimeRelationships(
            tracker,
            mutations,
            tracker.entries().filter(entry =>
                this.properties.has(entry.entity)),
        );
        const entities = new Set([
            ...this.properties.keys(),
            ...navigations.keys(),
        ]);
        return new Map([...entities].map(entity => [entity, {
            foreignKeys: this.properties.get(entity) ?? new Set(),
            navigations: navigations.get(entity) ?? new Set(),
        }]));
    }

    public rememberAcceptance(
        snapshots: readonly PersistedEntrySnapshot[],
    ): void {
        this.acceptance = snapshots;
    }

    public acceptanceSnapshots(): readonly PersistedEntrySnapshot[] {
        return this.acceptance;
    }
}
