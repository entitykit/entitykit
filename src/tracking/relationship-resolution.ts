import type { Model } from '../model/model';
import {
    dependentRelationshipBoundKey,
    principalRelationshipBoundKey,
    relationshipKeyValuesEqual,
} from '../model/relationship-key-codec';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export function findTrackedPrincipal(
    tracker: ChangeTracker,
    model: Model,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): EntityEntry<object> | undefined {
    const values = dependent.entity as Record<string, unknown>;
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
            entry.entity as Record<string, unknown>,
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
): boolean {
    const values = dependent.entity as Record<string, unknown>;
    if (values[relationship.navigationProperty] === principal.entity) {
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
            principal.entity as Record<string, unknown>,
        );
}
