import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { cascadeGraphHasDynamicAccessors } from './cascade-graph-stability';
import { LoadedInverseCollectionBatch } from './loaded-inverse-collection-batch';
import { inertNavigationLoadTrackerJournal } from './navigation-load-tracker-journal';
import { directNavigationWriter } from './navigation-writer';

/** The outer detection journal owns restoration; dynamic graph edits stay live. */
export function relationshipDetectionInverseBatch(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
): LoadedInverseCollectionBatch | undefined {
    const added = entries.filter(entry => entry.state === EntityState.Added);
    // Added relationship owners can be detached during required/one-to-one
    // orphan handling. Preserve immediate publication for that ownership path.
    if (added.some(entry => entry.metadata.relationships.length > 0 || model.entities.some(metadata =>
        metadata.relationships.some(relationship => relationship.principalEntity === entry.metadata.ctor)))) return undefined;
    if (cascadeGraphHasDynamicAccessors(entries, model)) return undefined;
    return new LoadedInverseCollectionBatch(tracker, directNavigationWriter, inertNavigationLoadTrackerJournal);
}
