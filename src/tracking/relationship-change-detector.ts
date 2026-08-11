import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import { detectTrackedCascades } from './relationship-delete-detector';
import { detectInverseChanges } from './relationship-inverse-detector';
import { detectReferenceChanges } from './relationship-reference-detector';
import type { RelationshipDetectionValues } from './relationship-detection-values';

/** Detect navigation/FK changes and fix up only the already-tracked graph. */
export function detectRelationshipChanges(
    tracker: ChangeTracker,
    model: Model,
    values?: RelationshipDetectionValues,
): void {
    const entries = tracker.entries();
    detectReferenceChanges(tracker, model, entries, values);
    detectInverseChanges(tracker, model, entries, values);
    detectTrackedCascades(tracker, model, values);
}
