import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { detectTrackedCascades } from './relationship-delete-detector';
import { detectInverseChanges } from './relationship-inverse-detector';
import { detectReferenceChanges } from './relationship-reference-detector';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { relationshipDetectionInverseBatch } from './relationship-detection-inverse-batch';

/** Detect navigation/FK changes and fix up only the already-tracked graph. */
export function detectRelationshipChanges(
    tracker: ChangeTracker,
    model: Model,
    values: RelationshipDetectionValues,
    entries: ReadonlyArray<EntityEntry<object>> = tracker.entries(),
): void {
    const inverseCollections = relationshipDetectionInverseBatch(tracker, model, entries);
    detectReferenceChanges(tracker, model, entries, values, inverseCollections);
    // Keep the original baseline until inverse intent has observed the complete
    // reference fixup. Its existing precedence and pending edits stay intact.
    inverseCollections?.publish(() => undefined);
    detectInverseChanges(tracker, model, entries, values, inverseCollections);
    detectTrackedCascades(tracker, model, values);
}
