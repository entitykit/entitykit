import type { Model } from '../model/model';
import { readPropertyPath, readPropertyValue } from '../model/property-value-access';
import type { ChangeTracker } from './change-tracker';
import { relationshipDetectionIdentityKey } from './change-tracker-relationship-detection-registry';
import { captureEntryLoadedNavigations } from './entity-entry-navigation-checkpoint';
import type { EntityEntry } from './entity-entry';
import { captureNavigationChangeDetectionState } from './navigation-change-detection-state';
import { captureNavigationSnapshotValues } from './navigation-snapshot';
import type { RelationshipDetectionCheckpoint } from './relationship-detection-journal';
import { restoreRelationshipDetection } from './relationship-detection-restore';
import { cloneBoundValues } from './bound-value-snapshot';
import { cloneSnapshotValue, snapshotPropertyValue } from './snapshot-value';
import { temporaryGeneratedIdentity } from './temporary-generated-identity';

/** Capture every tracker and graph fact a concurrency operation may mutate. */
export function captureConcurrencyRestoration(
    tracker: ChangeTracker,
    model: Model,
): { rollback(): void } {
    const checkpoints = tracker.entries().map(entry =>
        captureEntry(tracker, model, entry));
    return {
        rollback(): void {
            restoreRelationshipDetection(tracker, checkpoints);
        },
    };
}

function captureEntry(
    tracker: ChangeTracker,
    model: Model,
    entry: EntityEntry<object>,
): RelationshipDetectionCheckpoint {
    const identityKey = relationshipDetectionIdentityKey(tracker, entry);
    if (identityKey === undefined) {
        throw new Error('Tracked entity has no registered identity.');
    }
    const navigationNames = navigationProperties(model, entry);
    const entity = entry.entity as Record<string, unknown>;
    return {
        entry,
        identityKey,
        state: entry.state,
        originalValues: cloneRecord(entry.originalValues),
        originalBoundValues: cloneBoundValues(entry.originalBoundValues),
        navigations: captureNavigationSnapshotValues(entry),
        loaded: captureEntryLoadedNavigations(entry),
        suppressed: captureNavigationChangeDetectionState(entry),
        temporaryIdentity: temporaryGeneratedIdentity(entry),
        properties: new Map(entry.metadata.properties.map(property => [
            property.propertyName,
            snapshotPropertyValue(
                readPropertyValue(entity, property),
                property.converter,
                `${entry.metadata.entityName}.${property.propertyName}`,
            ),
        ])),
        complex: entry.metadata.complexProperties.map(property => ({
            path: property.propertyPath,
            value: readPropertyPath(entity, property.propertyPath),
        })),
        graph: new Map([...navigationNames].map(property => [
            property, cloneGraphValue(entity[property]),
        ])),
    };
}

function navigationProperties(
    model: Model,
    entry: EntityEntry<object>,
): Set<string> {
    const names = new Set(entry.metadata.relationships.map(
        relationship => String(relationship.navigationProperty),
    ));
    for (const dependent of model.entities) {
        for (const relationship of dependent.relationships) {
            const inverse: unknown = relationship.inverseNavigationProperty;
            if (relationship.principalEntity === entry.metadata.ctor &&
                typeof inverse === 'string') names.add(inverse);
        }
    }
    return names;
}

function cloneRecord(
    values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, cloneSnapshotValue(value),
    ]));
}

function cloneGraphValue(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
