import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import {
    acceptNavigationSnapshotValues,
    captureNavigationSnapshotValues,
    navigationValueChanged,
    type NavigationSnapshotValues,
} from '../tracking/navigation-snapshot';
import { snapshotPropertyValuesEqual } from '../tracking/snapshot-value';
import type { EntityState } from '../tracking/entity-state';
import type { EntityEntry } from '../tracking/entity-entry';
import type { SaveTimeMutationLog } from './save-time-mutations';
import {
    captureGenerationForeignKeys,
    captureGenerationNavigations,
    cloneNavigationValue,
    generationForeignKeyWasEdited,
    restoreGenerationNavigation,
    type NavigationCheckpoint,
} from './save-time-relationship-generation-values';
interface EntryCheckpoint {
    readonly persisted: PersistedEntrySnapshot;
    readonly state: EntityState;
    readonly foreignKeys: ReadonlyMap<string, unknown>;
    readonly navigations: readonly NavigationCheckpoint[];
    readonly baselines: NavigationSnapshotValues;
}
export class SaveTimeRelationshipGeneration {
    private readonly checkpoints: readonly EntryCheckpoint[];
    private readonly foreignKeyChanges: Set<EntityEntry<object>> = new Set();
    constructor(
        snapshots: readonly PersistedEntrySnapshot[],
        private readonly mutations: SaveTimeMutationLog,
    ) {
        this.checkpoints = snapshots.map(snapshot => ({
            persisted: snapshot,
            state: snapshot.entry.state,
            foreignKeys: captureGenerationForeignKeys(snapshot),
            navigations: captureGenerationNavigations(snapshot),
            baselines: captureNavigationSnapshotValues(snapshot.entry),
        }));
    }
    /** Record guarded rollback after relationship detection completes. */
    public complete(): void {
        for (const checkpoint of this.checkpoints) {
            this.recordForeignKeys(checkpoint);
            const entry = checkpoint.persisted.entry;
            if (entry.state !== checkpoint.state) {
                this.mutations.recordAppliedState(
                    entry, checkpoint.state, entry.state,
                );
            }
            this.recordNavigations(checkpoint);
        }
    }
    public changedForeignKeyEntries(): ReadonlySet<EntityEntry<object>> {
        return this.foreignKeyChanges;
    }
    private recordForeignKeys(checkpoint: EntryCheckpoint): void {
        const { entry, values } = checkpoint.persisted;
        for (const [propertyName, previous] of checkpoint.foreignKeys) {
            const applied = values[propertyName];
            const property = entry.metadata.getProperty(propertyName);
            if (snapshotPropertyValuesEqual(
                previous,
                applied,
                property.converter,
                `${entry.metadata.entityName}.${propertyName}`,
            )) continue;
            this.foreignKeyChanges.add(entry);
            this.mutations.recordApplied(
                entry.entity,
                property,
                previous,
                applied,
                `${entry.metadata.entityName}.${propertyName}`,
            );
        }
    }
    private recordNavigations(checkpoint: EntryCheckpoint): void {
        const entry = checkpoint.persisted.entry;
        const entity = entry.entity as Record<string, unknown>;
        const appliedBaselines = captureNavigationSnapshotValues(entry);
        const appliedForeignKeys = captureGenerationForeignKeys(
            checkpoint.persisted,
        );
        const changes = checkpoint.navigations.flatMap(previous => {
            const applied = cloneNavigationValue(entity[previous.property]);
            const restoreLive = navigationValueChanged(previous.snapshot, applied);
            const restoreBaseline = navigationValueChanged(
                checkpoint.baselines.get(previous.property),
                appliedBaselines.get(previous.property),
            );
            return restoreLive || restoreBaseline
                ? [{ previous, applied, restoreLive, restoreBaseline }]
                : [];
        });
        if (changes.length === 0) return;
        this.mutations.recordRestoration(() => {
            const baselines = new Map(captureNavigationSnapshotValues(entry));
            let restoreBaselines = false;
            const foreignKeyEdited = changes.some(change =>
                !change.restoreLive && change.restoreBaseline,
            ) && generationForeignKeyWasEdited(
                checkpoint.persisted, appliedForeignKeys,
            );
            for (const change of changes) {
                const { previous, applied } = change;
                if (navigationValueChanged(entity[previous.property], applied)) {
                    continue;
                }
                if (change.restoreLive) {
                    restoreGenerationNavigation(entity, previous);
                } else if (foreignKeyEdited) {
                    continue;
                }
                if (!change.restoreBaseline) continue;
                if (navigationValueChanged(
                    baselines.get(previous.property),
                    appliedBaselines.get(previous.property),
                )) {
                    continue;
                }
                restoreBaselines = true;
                if (checkpoint.baselines.has(previous.property)) {
                    baselines.set(
                        previous.property,
                        checkpoint.baselines.get(previous.property),
                    );
                } else {
                    baselines.delete(previous.property);
                }
            }
            if (restoreBaselines) {
                acceptNavigationSnapshotValues(entry, baselines);
            }
        });
    }
}
