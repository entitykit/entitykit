import type { EntityEntry } from './entity-entry';
import type { ChangeTracker } from './change-tracker';
import { changeTrackerModel } from './change-tracker-model';
import { detectRelationshipChanges } from './relationship-change-detector';
import { detectReferenceChanges } from './relationship-reference-detector';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { captureRelationshipDetectionValues } from './relationship-detection-values';
import { captureRelationshipFixupBaseline } from './relationship-fixup-baseline';
import { captureRelationshipDetectionJournal } from './relationship-detection-journal';
import { assertSupportedOneToOneChanges } from './one-to-one-change-validation';

export function detectTrackedChanges(
    tracker: ChangeTracker,
    entries: ReadonlyArray<EntityEntry<object>>,
): void {
    detectTrackedRelationships(tracker);
    for (const entry of entries) {
        entry.detectChanges();
    }
}

export function detectTrackedRelationships(
    tracker: ChangeTracker,
    entries?: ReadonlyArray<EntityEntry<object>>,
    values?: RelationshipDetectionValues,
    refreshBaselines = true,
): void {
    const configuredModel = changeTrackerModel(tracker);
    if (configuredModel) {
        const captured = captureRelationshipDetectionValues(
            tracker.entries(), values,
        );
        const journal = captureRelationshipDetectionJournal(
            tracker,
            configuredModel,
            captured,
        );
        const acceptFixup = refreshBaselines
            ? captureRelationshipFixupBaseline(tracker.entries())
            : undefined;
        try {
            assertSupportedOneToOneChanges(
                tracker,
                configuredModel,
                captured,
            );
            if (entries) {
                detectReferenceChanges(tracker, configuredModel, entries, captured);
            } else {
                detectRelationshipChanges(tracker, configuredModel, captured);
            }
            acceptFixup?.();
            journal.commit();
        } catch (error) {
            journal.rollback();
            throw error;
        }
    }
}
