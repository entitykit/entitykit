import type { Model } from '../model/model';
import type { EntityEntry } from './entity-entry';
import { captureNavigation } from './navigation-snapshot';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

/** Capture every reference and inverse navigation declared for this entity. */
export function initializeNavigationSnapshots(
    entry: EntityEntry<object>,
    model: Model,
): void {
    const properties = new Set(entry.metadata.relationships.map(
        relationship => String(relationship.navigationProperty),
    ));
    for (const relationship of entry.metadata.manyToManyRelationships) {
        properties.add(String(relationship.navigationProperty));
    }
    for (const dependent of model.entities) {
        collectOrdinaryInverses(entry, dependent.relationships, properties);
        for (const relationship of dependent.manyToManyRelationships) {
            const inverse: unknown = relationship.inverseNavigationProperty;
            if (
                relationship.targetEntity === entry.metadata.ctor &&
                typeof inverse === 'string'
            ) properties.add(inverse);
        }
    }
    for (const property of properties) captureNavigation(entry, property);
}

function collectOrdinaryInverses(
    entry: EntityEntry<object>,
    relationships: readonly object[],
    properties: Set<string>,
): void {
    for (const relationship of relationships as
        readonly TrackedRelationshipMetadata[]) {
        if (
            relationship.principalEntity === entry.metadata.ctor &&
            relationship.inverseNavigationProperty
        ) properties.add(relationship.inverseNavigationProperty);
    }
}
