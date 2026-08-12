import type { EntityMetadata } from '../model/entity-metadata';
import {
    principalBoundValuesForDependent,
    principalValuesForDependent,
} from '../model/relationship-key-translation';
import type { EntityEntry } from './entity-entry';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import {
    relationshipBoundValuesFor,
    relationshipValuesFor,
} from './relationship-detection-values';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export function foreignKeyValuesForPrincipal(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principalMetadata: EntityMetadata<Record<string, unknown>>,
    principal: object,
    principalEntry?: EntityEntry<object>,
    captured?: RelationshipDetectionValues,
): readonly unknown[] {
    return principalEntry && captured
        ? principalBoundValuesForDependent(
            relationship,
            dependent.metadata,
            principalMetadata,
            relationshipBoundValuesFor(principalEntry, captured),
        )
        : principalValuesForDependent(
            relationship,
            dependent.metadata,
            principalMetadata,
            principalEntry
                ? relationshipValuesFor(principalEntry, captured)
                : principal as Record<string, unknown>,
        );
}
