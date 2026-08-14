import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export function staleGeneratedRelationshipTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): Error {
    return new Error(
        `Relationship '${dependent.metadata.entityName}.` +
        `${relationship.navigationProperty}' retains a rolled-back ` +
        'store-generated FK for a principal that is no longer tracked. ' +
        'Assign another principal navigation or foreign key before saving.',
    );
}

export function ambiguousRestoredGeneratedRelationshipTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): Error {
    return new Error(
        `Relationship '${dependent.metadata.entityName}.` +
        `${relationship.navigationProperty}' was restored after a ` +
        'generated-key rollback, so its scalar FK is ambiguous. Assign the ' +
        'intended principal navigation explicitly before retrying this save.',
    );
}
