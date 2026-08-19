import type { Model } from '../model/model';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    clearStaleReference,
    linkDependent,
} from './relationship-fixup';
import { findTrackedPrincipalByBoundValues } from './relationship-resolution';
import { captureNavigation } from './navigation-snapshot';
import { snapshotValuesEqual } from './snapshot-value-equality';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import { captureEntityPersistenceFacts } from './entity-persistence-fact-capture';

export function captureReloadRelationshipBoundValues<TEntity extends object>(
    entry: EntityEntry<TEntity>,
): Record<string, unknown> {
    const properties = new Set(entry.metadata.relationships.flatMap(
        relationship => relationship.foreignKeyProperties as readonly string[],
    ));
    return captureEntityPersistenceFacts(
        entry.metadata,
        entry.entity,
        properties,
    ).boundValues;
}

/** Keep tracked references coherent when a database-wins reload changes an FK. */
export function fixupReloadedRelationships(
    tracker: ChangeTracker,
    model: Model,
    entry: EntityEntry<object>,
    previousBoundValues: Readonly<Record<string, unknown>>,
    reloadedBoundValues: Readonly<Record<string, unknown>>,
): void {
    const relationships = entry.metadata.relationships as
        readonly TrackedRelationshipMetadata[];
    for (const relationship of relationships) {
        const changed = relationship.foreignKeyProperties.some(name =>
            !snapshotValuesEqual(
                previousBoundValues[name],
                reloadedBoundValues[name],
            ));
        if (!changed) {
            continue;
        }

        const principal = findTrackedPrincipalByBoundValues(
            tracker,
            model,
            entry,
            relationship,
            reloadedBoundValues,
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
