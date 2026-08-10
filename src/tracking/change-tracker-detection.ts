import type { EntityEntry } from './entity-entry';
import type { ChangeTracker } from './change-tracker';
import { changeTrackerModel } from './change-tracker-model';
import { detectRelationshipChanges } from './relationship-change-detector';

export function detectTrackedChanges(
    tracker: ChangeTracker,
    entries: ReadonlyArray<EntityEntry<object>>,
): void {
    detectTrackedRelationships(tracker);
    for (const entry of entries) {
        entry.detectChanges();
    }
}

export function detectTrackedRelationships(tracker: ChangeTracker): void {
    const configuredModel = changeTrackerModel(tracker);
    if (configuredModel) {
        detectRelationshipChanges(tracker, configuredModel);
    }
}
