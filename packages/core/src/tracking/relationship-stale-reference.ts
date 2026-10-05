import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import type { LoadedInverseCollectionBatch } from './loaded-inverse-collection-batch';
import { removeFromRelationshipInverse } from './relationship-inverse-fixup';
import { directNavigationWriter } from './navigation-writer';
import { writeVerifiedNavigation } from './verified-navigation-write';

export function clearStaleReference(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    inverseCollections?: LoadedInverseCollectionBatch,
): void {
    const previous = (dependent.entity as Record<string, unknown>)[relationship.navigationProperty];
    writeVerifiedNavigation(dependent.entity, relationship.navigationProperty, null, dependent.metadata.entityName);
    dependent.markNavigationNotLoaded(relationship.navigationProperty);
    if (previous) removeFromRelationshipInverse(
        tracker, relationship, previous, dependent.entity, directNavigationWriter, inverseCollections,
    );
}
