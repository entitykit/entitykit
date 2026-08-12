import type { Model } from '../model/model';
import {
    dependentRelationshipBoundKey,
    principalRelationshipBoundKey,
    relationshipKeyValuesEqual,
} from '../model/relationship-key-codec';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { relationshipValuesFor } from './relationship-detection-values';

export function findTrackedPrincipal(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured?: RelationshipDetectionValues,
): EntityEntry<object> | undefined {
    const values = relationshipValuesFor(dependent, captured);
    const foreignKey = relationship.foreignKeyProperties.map(
        property => values[property],
    );
    if (foreignKey.some(value => value === null || value === undefined)) {
        return undefined;
    }
    const principalMetadata = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    return tracker.entries().find(entry =>
        entry.metadata === principalMetadata &&
        relationshipKeyValuesEqual(
            relationship,
            dependent.metadata,
            values,
            principalMetadata,
            relationshipValuesFor(entry, captured),
        ));
}

export function findTrackedPrincipalByBoundValues(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    dependentBoundValues: Readonly<Record<string, unknown>>,
): EntityEntry<object> | undefined {
    const foreignKey = relationship.foreignKeyProperties.map(
        property => dependentBoundValues[property],
    );
    if (foreignKey.some(value => value === null || value === undefined)) {
        return undefined;
    }
    const principalMetadata = model.getEntity<Record<string, unknown>>(
        relationship.principalEntity,
    );
    const key = dependentRelationshipBoundKey(
        relationship,
        dependentBoundValues,
    );
    return tracker.entries().find(entry =>
        entry.metadata === principalMetadata &&
        principalRelationshipBoundKey(
            relationship,
            principalMetadata,
            entry.originalBoundValues,
        ) === key);
}

export function relationshipConnects(
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
    captured?: RelationshipDetectionValues,
): boolean {
    const live = dependent.entity as Record<string, unknown>;
    const values = relationshipValuesFor(dependent, captured);
    if (live[relationship.navigationProperty] === principal.entity) {
        return true;
    }
    const foreignKey = relationship.foreignKeyProperties.map(
        property => values[property],
    );
    return !foreignKey.some(value => value === null || value === undefined) &&
        relationshipKeyValuesEqual(
            relationship,
            dependent.metadata,
            values,
            model.getEntity<Record<string, unknown>>(
                relationship.principalEntity,
            ),
            relationshipValuesFor(principal, captured),
        );
}

export function relationshipForeignKeyMatchesPrincipal(
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principalValues: Readonly<Record<string, unknown>>,
    captured?: RelationshipDetectionValues,
): boolean {
    const values = relationshipValuesFor(dependent, captured);
    const foreignKey = relationship.foreignKeyProperties.map(
        property => values[property],
    );
    return !foreignKey.some(value => value === null || value === undefined) &&
        relationshipKeyValuesEqual(
            relationship,
            dependent.metadata,
            values,
            model.getEntity<Record<string, unknown>>(
                relationship.principalEntity,
            ),
            principalValues,
        );
}
