import { RelationshipCardinality } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import {
    addToRelationshipInverse,
    removeFromRelationshipInverse,
} from './relationship-inverse-fixup';
import { navigationSnapshot } from './navigation-snapshot';
import { captureNavigation } from './navigation-snapshot';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import {
    inertNavigationLoadTrackerJournal,
    type NavigationLoadTrackerJournal,
} from './navigation-load-tracker-journal';
import {
    directNavigationWriter,
    type NavigationWriter,
} from './navigation-writer';

/**
 * Atomically stitch one loaded reference through both tracked inverse sides.
 *
 * Every write goes through the caller's journal, so a principal collection that
 * refuses the new dependent unwinds the dependent reference and the previous
 * inverse it already severed instead of leaving the two sides disagreeing. The
 * inverse baselines this re-captures are tracker facts rather than graph
 * writes, so each principal it reaches -- the new one and any previous one it
 * severs -- is recorded with the tracker journal, under the inverse navigation
 * it is about to move, before that baseline moves.
 */
export function fixupLoadedReference(
    tracker: ChangeTracker,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: object | null,
    writer: NavigationWriter = directNavigationWriter,
    trackerJournal: NavigationLoadTrackerJournal
        = inertNavigationLoadTrackerJournal,
): void {
    const values = dependent.entity as Record<string, unknown>;
    const current = values[relationship.navigationProperty];
    const baseline = navigationSnapshot(
        dependent, relationship.navigationProperty,
    );
    if (principal) {
        assertOneToOneSlotAvailable(dependent, relationship, principal);
    }
    for (const previous of new Set([current, baseline.value])) {
        if (previous && typeof previous === 'object' && previous !== principal) {
            removeFromRelationshipInverse(
                tracker, relationship, previous, dependent.entity, writer,
            );
            captureInverseBaseline(
                tracker, relationship, previous, trackerJournal,
            );
        }
    }
    writer.write(
        dependent.entity,
        relationship.navigationProperty,
        principal,
        dependent.metadata.entityName,
    );
    if (!principal) return;
    addToRelationshipInverse(
        tracker,
        relationship,
        principal,
        dependent,
        () => undefined,
        writer,
    );
    captureInverseBaseline(tracker, relationship, principal, trackerJournal);
}

function captureInverseBaseline(
    tracker: ChangeTracker,
    relationship: TrackedRelationshipMetadata,
    principal: object,
    trackerJournal: NavigationLoadTrackerJournal,
): void {
    const inverse = relationship.inverseNavigationProperty;
    const entry = tracker.entry(principal);
    if (!inverse || !entry) return;
    // The only fact this moves on the principal is the inverse navigation's
    // baseline, so that navigation alone is what the load has to hand back.
    trackerJournal.touch(entry, inverse);
    captureNavigation(entry, inverse);
}

function assertOneToOneSlotAvailable(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: object,
): void {
    const inverse = relationship.inverseNavigationProperty;
    if (
        relationship.cardinality !== RelationshipCardinality.OneToOne ||
        !inverse
    ) return;
    const existing = (principal as Record<string, unknown>)[inverse];
    if (existing && existing !== dependent.entity) {
        throw new Error(
            `One-to-one relationship '${inverse}' matched more than one dependent entity.`,
        );
    }
}
