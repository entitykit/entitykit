import type { Model } from '../model/model';
import { RelationshipCardinality } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import {
    captureNavigation,
    navigationSnapshot,
    navigationValueChanged,
} from './navigation-snapshot';
import {
    linkDependent,
    severDependent,
} from './relationship-fixup';
import { relationshipConnects } from './relationship-resolution';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import type { RelationshipDetectionValues } from './relationship-detection-values';

export function detectInverseChanges(
    tracker: ChangeTracker,
    model: Model,
    entries: ReadonlyArray<EntityEntry<object>>,
    captured?: RelationshipDetectionValues,
): void {
    for (const principal of entries) {
        if (principal.state === EntityState.Detached) {
            continue;
        }
        for (const dependentMetadata of model.entities) {
            const relationships = dependentMetadata.relationships as
                readonly TrackedRelationshipMetadata[];
            for (const relationship of relationships) {
                if (
                    relationship.principalEntity === principal.metadata.ctor &&
                    relationship.inverseNavigationProperty
                ) {
                    detectInverseChange(
                        tracker,
                        model,
                        principal,
                        relationship,
                        captured,
                    );
                }
            }
        }
    }
}

function detectInverseChange(
    tracker: ChangeTracker,
    model: Model,
    principal: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    captured?: RelationshipDetectionValues,
): void {
    const inverse = relationship.inverseNavigationProperty;
    if (!inverse) {
        return;
    }
    const snapshot = navigationSnapshot(principal, inverse);
    const current = (principal.entity as Record<string, unknown>)[inverse];
    if (!snapshot.known || !navigationValueChanged(snapshot.value, current)) {
        return;
    }

    const previousItems = navigationItems(snapshot.value, relationship);
    const currentItems = navigationItems(current, relationship);
    let handled = true;
    for (const entity of currentItems.filter(item => !previousItems.includes(item))) {
        const dependent = tracker.entry(entity);
        const relationships = dependent?.metadata.relationships as
            readonly TrackedRelationshipMetadata[] | undefined;
        if (dependent && relationships?.includes(relationship)) {
            linkDependent(
                tracker, model, dependent, relationship,
                principal.entity, undefined, captured,
            );
        } else {
            handled = false;
        }
    }
    for (const entity of previousItems.filter(item => !currentItems.includes(item))) {
        const dependent = tracker.entry(entity);
        if (
            dependent &&
            dependent.state !== EntityState.Detached &&
            relationshipConnects(
                model, dependent, relationship, principal, captured,
            )
        ) {
            severDependent(
                tracker, dependent, relationship, principal.entity, captured,
            );
        } else if (!dependent) {
            handled = false;
        }
    }
    if (handled) captureNavigation(principal, inverse);
}

function navigationItems(
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
