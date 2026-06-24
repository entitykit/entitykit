import type { Model } from '../model/model';
import { relationshipPrincipalKeyValues } from '../model/relationship-key';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { snapshotPropertyValuesEqual } from './snapshot-value';
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
        tuplesEqual(
            foreignKey,
            relationshipPrincipalKeyValues(
                relationship,
                principalMetadata,
                entry.entity as Record<string, unknown>,
            ),
        ));
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
        tuplesEqual(
            foreignKey,
            relationshipPrincipalKeyValues(
                relationship,
                model.getEntity<Record<string, unknown>>(
                    relationship.principalEntity,
                ),
                principal.entity as Record<string, unknown>,
            ),
        );
}

function tuplesEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length &&
        left.every((value, index) =>
            snapshotPropertyValuesEqual(value, right[index]));
}
