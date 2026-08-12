import type { Model } from '../model/model';
import {
    dependentRelationshipBoundKey,
    principalRelationshipBoundKey,
} from '../model/relationship-key-codec';
import type { EntityEntry } from './entity-entry';
import { capturePropertyPersistenceFact } from './entity-persistence-fact-capture';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import {
    relationshipBoundValuesFor,
    relationshipValuesFor,
} from './relationship-detection-values';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export function relationshipForeignKeyMatchesUntrackedPrincipal(
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principalValues: Readonly<Record<string, unknown>>,
    captured: RelationshipDetectionValues,
): boolean {
    const dependentValues = relationshipValuesFor(dependent, captured);
    if (relationship.foreignKeyProperties.some(property =>
        dependentValues[property] === null ||
        dependentValues[property] === undefined,
    )) return false;
    const principal = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    const properties = relationship.principalKeyProperties ??
        principal.keyProperties;
    const boundValues = Object.fromEntries(properties.map(propertyName => [
        propertyName,
        capturePropertyPersistenceFact(
            principal,
            principal.getProperty(propertyName),
            principalValues[propertyName],
        ).boundValue,
    ]));
    return dependentRelationshipBoundKey(
        relationship,
        relationshipBoundValuesFor(dependent, captured),
    ) === principalRelationshipBoundKey(
        relationship, principal, boundValues,
    );
}
