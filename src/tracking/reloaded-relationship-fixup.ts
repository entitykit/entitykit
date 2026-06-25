import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    clearStaleReference,
    linkDependent,
} from './relationship-fixup';
import { findTrackedPrincipal } from './relationship-resolution';
import { captureNavigation } from './navigation-snapshot';
import { snapshotPropertyValuesEqual } from './snapshot-value';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

/** Keep tracked references coherent when a database-wins reload changes an FK. */
export function fixupReloadedRelationships(
    tracker: ChangeTracker,
    model: Model,
    entry: EntityEntry<object>,
    previousValues: Readonly<Record<string, unknown>>,
): void {
    const current = entry.entity as Record<string, unknown>;
    const relationships = entry.metadata.relationships as
        readonly TrackedRelationshipMetadata[];
    for (const relationship of relationships) {
        const changed = relationship.foreignKeyProperties.some(name => {
            const property = entry.metadata.getProperty(name);
            return !snapshotPropertyValuesEqual(
                previousValues[name],
                current[name],
                property.converter,
            );
        });
        if (!changed) {
            continue;
        }

        const principal = findTrackedPrincipal(
            tracker,
            model,
            entry,
            relationship,
        );
        if (principal) {
            linkDependent(
                tracker,
                model,
                entry,
                relationship,
                principal.entity,
            );
        } else {
            clearStaleReference(tracker, entry, relationship);
        }
        entry.markNavigationNotLoaded(relationship.navigationProperty);
        captureNavigation(entry, relationship.navigationProperty);
    }
}
