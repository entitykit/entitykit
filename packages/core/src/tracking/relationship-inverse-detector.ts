import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { resolveInverseIntents } from './relationship-inverse-intents';
import type { LoadedInverseCollectionBatch } from './loaded-inverse-collection-batch';

/** Apply inverse changes from one complete, tracker-order-independent graph. */
export function detectInverseChanges(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
    captured: RelationshipDetectionValues,
    inverseCollections?: LoadedInverseCollectionBatch,
): void {
    resolveInverseIntents(tracker, model, entries, captured, inverseCollections);
}
