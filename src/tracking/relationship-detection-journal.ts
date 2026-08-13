import type { Model } from '../model/model';
import { cloneBoundEntityValues } from './bound-entity-value-clone';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { cloneSnapshotValue } from './entity-entry';
import {
    captureNavigationChangeDetectionState,
} from './navigation-change-detection-state';
import {
    captureNavigationSnapshotValues,
    type NavigationSnapshotValues,
} from './navigation-snapshot';
import { cloneBoundValues } from './bound-value-snapshot';
import {
    temporaryGeneratedIdentity,
    type TemporaryGeneratedIdentity,
} from './temporary-generated-identity';
import type { EntityState } from './entity-state';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import {
    relationshipDetectionIdentityKey,
    beginRelationshipDetectionDetachScope,
} from './change-tracker-relationship-detection-registry';
import {
    captureEntryLoadedNavigations,
} from './entity-entry-navigation-checkpoint';
import { restoreRelationshipDetection } from './relationship-detection-restore';

export interface RelationshipDetectionCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly identityKey: string;
    readonly state: EntityState;
    readonly originalValues: Record<string, unknown>;
    readonly originalBoundValues: Record<string, unknown>;
    readonly navigations: NavigationSnapshotValues;
    readonly loaded: ReadonlyMap<string, string | null>;
    readonly suppressed: ReadonlySet<string>;
    readonly temporaryIdentity?: TemporaryGeneratedIdentity;
    readonly properties: ReadonlyMap<string, unknown>;
    readonly graph: ReadonlyMap<string, unknown>;
}
export function captureRelationshipDetectionJournal(
    tracker: ChangeTracker,
    model: Model,
    captured: RelationshipDetectionValues,
): { commit(): void; rollback(): void } {
    const checkpoints = tracker.entries().map(entry =>
        captureEntry(tracker, model, entry, captured));
    const detachScope = beginRelationshipDetectionDetachScope(tracker);
    return {
        commit(): void {
            detachScope.commit();
        },
        rollback(): void {
            restoreRelationshipDetection(tracker, checkpoints);
            detachScope.rollback();
        },
    };
}
function captureEntry(
    tracker: ChangeTracker,
    model: Model,
    entry: EntityEntry<object>,
    captured: RelationshipDetectionValues,
): RelationshipDetectionCheckpoint {
    const identityKey = relationshipDetectionIdentityKey(tracker, entry);
    if (identityKey === undefined) {
        throw new Error('Tracked entity has no registered identity.');
    }
    const propertyNames = new Set(entry.metadata.relationships.flatMap(
        relationship => relationship.foreignKeyProperties.map(String),
    ));
    const navigationNames = new Set(entry.metadata.relationships.map(
        relationship => String(relationship.navigationProperty),
    ));
    for (const dependent of model.entities) {
        for (const relationship of dependent.relationships) {
            const inverse: unknown = relationship.inverseNavigationProperty;
            if (
                relationship.principalEntity === entry.metadata.ctor &&
                typeof inverse === 'string'
            ) {
                navigationNames.add(inverse);
            }
        }
    }
    const entity = entry.entity as Record<string, unknown>;
    return {
        entry,
        identityKey,
        state: entry.state,
        originalValues: cloneBoundEntityValues(
            entry.metadata,
            { ...entry.originalValues },
            entry.originalBoundValues,
        ),
        originalBoundValues: cloneBoundValues(entry.originalBoundValues),
        navigations: captureNavigationSnapshotValues(entry),
        loaded: captureEntryLoadedNavigations(entry),
        suppressed: captureNavigationChangeDetectionState(entry),
        temporaryIdentity: temporaryGeneratedIdentity(entry),
        properties: new Map([...propertyNames].map(propertyName => [
            propertyName,
            cloneSnapshotValue(captured.get(entry)?.[propertyName]),
        ])),
        graph: new Map([...navigationNames].map(propertyName => [
            propertyName,
            cloneGraphValue(entity[propertyName]),
        ])),
    };
}
function cloneGraphValue(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}
function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
