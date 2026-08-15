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
import type { RestorationScope } from '../restoration-scope';

export function detectTrackedChanges(
    tracker: ChangeTracker,
    entries: ReadonlyArray<EntityEntry<object>>,
    restoration: RestorationScope,
): void {
    runTrackedDetection(
        tracker, undefined, undefined, true, restoration,
        () => {
            for (const entry of entries) entry.detectChanges();
        },
        () => undefined,
    );
}

export function detectTrackedRelationships(
    tracker: ChangeTracker,
    entries?: ReadonlyArray<EntityEntry<object>>,
    values?: RelationshipDetectionValues,
    refreshBaselines = true,
    restoration?: RestorationScope,
    beforeCommit: () => void = () => undefined,
): void {
    if (!restoration) {
        throw new Error('Relationship detection requires a restoration scope.');
    }
    runTrackedDetection(
        tracker, entries, values, refreshBaselines, restoration,
        () => undefined,
        beforeCommit,
    );
}

function runTrackedDetection(
    tracker: ChangeTracker,
    entries: ReadonlyArray<EntityEntry<object>> | undefined,
    values: RelationshipDetectionValues | undefined,
    refreshBaselines: boolean,
    restoration: RestorationScope,
    afterRelationships: () => void,
    beforeCommit: () => void,
): void {
    const configuredModel = changeTrackerModel(tracker);
    if (!configuredModel) {
        afterRelationships();
        beforeCommit();
        return;
    }
    const tracked = tracker.entries();
    const captured = captureRelationshipDetectionValues(tracked, values);
    const journal = captureRelationshipDetectionJournal(
        tracker, configuredModel, captured, restoration,
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
        beforeCommit();
        journal.commit();
    } catch (error) {
        restoration.capturePrimary(error);
        restoration.attempt(journal.rollback.bind(journal));
        throw error;
    }
}
