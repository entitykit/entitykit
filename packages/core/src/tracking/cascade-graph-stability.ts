import type { Model } from '../model/model';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import { navigationPropertyHasDynamicBehavior } from './navigation-property-stability';

/** Entity and collection hooks can redirect other edges while a cascade runs. */
export function cascadeGraphHasDynamicAccessors(
    entries: ReadonlyArray<EntityEntry<object>>,
    model: Model,
): boolean {
    const properties: Map<object, Set<string>> = new Map();
    const add = (metadata: object, names: readonly string[]): void => {
        const mapped = properties.get(metadata) ?? new Set<string>();
        for (const name of names) mapped.add(name);
        properties.set(metadata, mapped);
    };
    for (const metadata of model.entities) {
        for (const relationship of metadata.relationships as readonly TrackedRelationshipMetadata[]) {
            add(metadata, [relationship.navigationProperty, ...relationship.foreignKeyProperties]);
            if (relationship.inverseNavigationProperty) {
                add(model.getEntity(relationship.principalEntity), [relationship.inverseNavigationProperty]);
            }
        }
    }
    for (const entry of entries) {
        for (const property of properties.get(entry.metadata) ?? []) {
            if (navigationPropertyHasDynamicBehavior(entry.entity, property)) return true;
        }
    }
    return false;
}
