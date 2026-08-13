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
import { captureOneToOneIntentGroups } from './one-to-one-change-intent';
import { orderOneToOneChanges } from './one-to-one-change-order';

export function detectTrackedChanges(
    tracker: ChangeTracker,
    entries: ReadonlyArray<EntityEntry<object>>,
): void {
    runTrackedDetection(tracker, undefined, undefined, true, () => {
        for (const entry of entries) entry.detectChanges();
    });
}

export function detectTrackedRelationships(
    tracker: ChangeTracker,
    entries?: ReadonlyArray<EntityEntry<object>>,
    values?: RelationshipDetectionValues,
    refreshBaselines = true,
): void {
    runTrackedDetection(
        tracker, entries, values, refreshBaselines, () => undefined,
    );
}

function runTrackedDetection(
    tracker: ChangeTracker,
    entries: ReadonlyArray<EntityEntry<object>> | undefined,
    values: RelationshipDetectionValues | undefined,
    refreshBaselines: boolean,
    afterRelationships: () => void,
): void {
    const configuredModel = changeTrackerModel(tracker);
    if (!configuredModel) {
        afterRelationships();
        return;
    }
    const tracked = tracker.entries();
    const captured = captureRelationshipDetectionValues(tracked, values);
    const journal = captureRelationshipDetectionJournal(
        tracker, configuredModel, captured,
    );
    const acceptFixup = refreshBaselines
        ? captureRelationshipFixupBaseline(tracked)
        : undefined;
    try {
        const groups = captureOneToOneIntentGroups(
            tracker, configuredModel, captured,
        );
        assertSupportedOneToOneChanges(groups);
        const ordered = orderOneToOneChanges(entries ?? tracked, groups);
        if (entries) {
            detectReferenceChanges(
                tracker, configuredModel, ordered, captured,
            );
        } else {
            detectRelationshipChanges(
                tracker, configuredModel, captured, ordered,
            );
        }
        afterRelationships();
        acceptFixup?.();
        journal.commit();
    } catch (error) {
        journal.rollback();
        throw error;
    }
}
