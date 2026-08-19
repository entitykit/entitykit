import { RelationshipCardinality } from '../model/relationship-metadata';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export function navigationItems(
    value: unknown,
    relationship: TrackedRelationshipMetadata,
): object[] {
    if (relationship.cardinality === RelationshipCardinality.OneToOne) {
        return value && typeof value === 'object' ? [value] : [];
    }
    return Array.isArray(value)
        ? value.filter((item): item is object =>
            Boolean(item) && typeof item === 'object')
        : [];
}
