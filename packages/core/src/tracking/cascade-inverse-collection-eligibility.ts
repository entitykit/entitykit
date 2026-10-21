import type { Model } from '../model/model';
import { DeleteBehavior } from '../model/relationship-metadata';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

/** Called after excluding dynamic entity and collection properties. */
export function cascadeInverseCollectionsCanBatch(
    entries: ReadonlyArray<EntityEntry<object>>,
    model: Model,
): boolean {
    const inverseProperties: Map<object, Set<string>> = new Map();
    const metadata = new Set(entries.map(entry => entry.metadata));
    for (const entity of metadata) {
        for (const relationship of entity.relationships as readonly TrackedRelationshipMetadata[]) {
            // A converter can observe earlier removals on any edge in this pass,
            // including when its own relationship has no inverse navigation.
            if (relationship.deleteBehavior === DeleteBehavior.SetNull &&
                relationship.foreignKeyProperties.some(name => {
                    const property = entity.getProperty(name);
                    return !property.isRequired && property.converter !== undefined;
                })) return false;
            const inverse = relationship.inverseNavigationProperty;
            if (!inverse) continue;
            const principal = model.getEntity(relationship.principalEntity);
            const properties = inverseProperties.get(principal) ?? new Set<string>();
            properties.add(inverse);
            inverseProperties.set(principal, properties);
        }
    }
    const checked: Set<unknown[]> = new Set();
    for (const entry of entries) {
        for (const property of inverseProperties.get(entry.metadata) ?? []) {
            const collection = (entry.entity as Record<string, unknown>)[property];
            if (!Array.isArray(collection) || checked.has(collection)) continue;
            checked.add(collection);
            // Direct filter-based removal skips holes but retains explicit
            // undefined values. Batch snapshots would turn holes into values.
            for (let index = 0; index < collection.length; index++) {
                if (!Object.hasOwn(collection, index)) return false;
            }
        }
    }
    return true;
}
