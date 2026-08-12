import { dependentRelationshipBoundKey } from '../model/relationship-key-codec';
import type { EntityEntry } from './entity-entry';
import { captureReferenceForeignKeyFacts } from './reference-foreign-key-facts';

/** Capture the provider FK tuple under which a reference is loaded. */
export function loadedReferenceKey(
    entry: EntityEntry<object>,
    navigationProperty: string,
    suppliedBoundValues?: Readonly<Record<string, unknown>>,
): string | null {
    const relationship = entry.metadata.relationships.find(candidate =>
        candidate.navigationProperty === navigationProperty,
    );
    if (!relationship) return null;
    const boundValues = suppliedBoundValues ??
        captureReferenceForeignKeyFacts(entry, relationship).boundValues;
    return dependentRelationshipBoundKey(
        relationship, boundValues,
    );
}
