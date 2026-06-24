import {
    RelationshipCardinality,
} from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export function addToRelationshipInverse(
    tracker: ChangeTracker,
    relationship: TrackedRelationshipMetadata,
    principal: object,
    dependent: EntityEntry<object>,
    severPrevious: (entry: EntityEntry<object>) => void,
): void {
    const inverse = relationship.inverseNavigationProperty;
    const principalEntry = tracker.entry(principal);
    if (!inverse || !principalEntry) {
        return;
    }
    const values = principal as Record<string, unknown>;
    if (relationship.cardinality === RelationshipCardinality.OneToOne) {
        const previous = values[inverse];
        if (previous && previous !== dependent.entity) {
            const previousEntry = tracker.entry(previous);
            if (previousEntry) {
                severPrevious(previousEntry);
            }
        }
        values[inverse] = dependent.entity;
        return;
    }
    const collection = Array.isArray(values[inverse]) ? values[inverse] : [];
    if (!collection.includes(dependent.entity)) {
        collection.push(dependent.entity);
    }
    values[inverse] = collection;
}

export function removeFromRelationshipInverse(
    tracker: ChangeTracker,
    relationship: TrackedRelationshipMetadata,
    principal: unknown,
    dependent: object,
): void {
    const inverse = relationship.inverseNavigationProperty;
    if (!inverse || !principal || !tracker.entry(principal)) {
        return;
    }
    const values = principal as Record<string, unknown>;
    if (Array.isArray(values[inverse])) {
        values[inverse] = values[inverse].filter(item => item !== dependent);
    } else if (values[inverse] === dependent) {
        values[inverse] = null;
    }
}
