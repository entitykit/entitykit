import {
    RelationshipCardinality,
} from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import { copyNavigationCollection } from './navigation-collection-copy';
import {
    directNavigationWriter,
    type NavigationWriter,
} from './navigation-writer';

export function addToRelationshipInverse(
    tracker: ChangeTracker,
    relationship: TrackedRelationshipMetadata,
    principal: object,
    dependent: EntityEntry<object>,
    severPrevious: (entry: EntityEntry<object>) => void,
    writer: NavigationWriter = directNavigationWriter,
): void {
    const inverse = relationship.inverseNavigationProperty;
    const principalEntry = tracker.entry(principal);
    if (!inverse || !principalEntry) {
        return;
    }
    const values = principal as Record<string, unknown>;
    const entityName = principalEntry.metadata.entityName;
    if (relationship.cardinality === RelationshipCardinality.OneToOne) {
        const previous = values[inverse];
        if (previous && previous !== dependent.entity) {
            const previousEntry = tracker.entry(previous);
            if (previousEntry) {
                severPrevious(previousEntry);
            }
        }
        writer.write(
            principal, inverse, dependent.entity, entityName,
        );
        return;
    }
    const collection = copyNavigationCollection(values[inverse]);
    if (!collection.includes(dependent.entity)) {
        collection.push(dependent.entity);
    }
    writer.write(principal, inverse, collection, entityName);
}

export function removeFromRelationshipInverse(
    tracker: ChangeTracker,
    relationship: TrackedRelationshipMetadata,
    principal: unknown,
    dependent: object,
    writer: NavigationWriter = directNavigationWriter,
): void {
    const inverse = relationship.inverseNavigationProperty;
    const principalEntry = principal && typeof principal === 'object'
        ? tracker.entry(principal)
        : undefined;
    if (!inverse || !principalEntry) {
        return;
    }
    const values = principalEntry.entity as Record<string, unknown>;
    const entityName = principalEntry.metadata.entityName;
    if (Array.isArray(values[inverse])) {
        writer.write(
            principalEntry.entity,
            inverse,
            values[inverse].filter(item => item !== dependent),
            entityName,
        );
    } else if (values[inverse] === dependent) {
        writer.write(
            principalEntry.entity, inverse, null, entityName,
        );
    }
}
