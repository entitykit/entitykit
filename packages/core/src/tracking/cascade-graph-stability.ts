import { types } from 'node:util';
import type { Model } from '../model/model';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

/** Arbitrary accessors/proxies can redirect other edges while a cascade runs. */
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
            if (hasAccessor(entry.entity, property)) return true;
        }
    }
    return false;
}

/** Inspect descriptors without calling user getters or proxy traps. */
function hasAccessor(entity: object, property: string): boolean {
    let owner: object | null = entity;
    while (owner) {
        if (types.isProxy(owner)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(owner, property);
        // Native accessor descriptors always contain both get and set keys.
        if (descriptor) return 'get' in descriptor;
        owner = Object.getPrototypeOf(owner) as object | null;
    }
    return false;
}
