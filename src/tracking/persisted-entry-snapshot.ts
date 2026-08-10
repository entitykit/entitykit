import type { EntityEntry } from './entity-entry';
import {
    captureNavigationSnapshotValues,
    type NavigationSnapshotValues,
} from './navigation-snapshot';
import { readPropertyPath } from '../model/property-value-access';
import type { EntityState } from './entity-state';

/** Exact tracked state represented by one executable save plan. */
export interface PersistedEntrySnapshot {
    readonly entry: EntityEntry<object>;
    readonly state: EntityState;
    readonly values: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
    readonly originalBoundValues: Record<string, unknown>;
    readonly relationshipValues: Readonly<Record<string, unknown>>;
    readonly complexPropertyValues: Readonly<Record<string, unknown>>;
    readonly navigations: NavigationSnapshotValues;
}

export function capturePersistedEntrySnapshot(
    entry: EntityEntry<object>,
): PersistedEntrySnapshot {
    const values = entry.currentValues();
    const state = entry.setStateFromCapturedValues(values);
    return capturePersistedEntrySnapshotFromValues(entry, state, values);
}

/** Capture manual acceptance without mutating entry state during preparation. */
export function captureManualAcceptanceSnapshot(
    entry: EntityEntry<object>,
): PersistedEntrySnapshot {
    return capturePersistedEntrySnapshotFromValues(
        entry,
        entry.state,
        entry.currentValues(),
    );
}

function capturePersistedEntrySnapshotFromValues(
    entry: EntityEntry<object>,
    state: EntityState,
    values: Record<string, unknown>,
): PersistedEntrySnapshot {
    return {
        entry,
        state,
        values,
        boundValues: {},
        originalBoundValues: {},
        relationshipValues: Object.fromEntries(
            entry.metadata.relationships.map(relationship => [
                String(relationship.navigationProperty),
                (entry.entity as Record<string, unknown>)[
                    relationship.navigationProperty
                ],
            ]),
        ),
        complexPropertyValues: Object.fromEntries(
            entry.metadata.complexProperties.map(property => [
                property.propertyName,
                readPropertyPath(entry.entity, property.propertyPath),
            ]),
        ),
        navigations: captureNavigationSnapshotValues(entry),
    };
}

export function persistedEntryKeyValue(
    snapshot: PersistedEntrySnapshot,
): unknown {
    const values = snapshot.entry.metadata.keyProperties.map(propertyName =>
        snapshot.values[propertyName]);
    return snapshot.entry.metadata.hasCompositeKey ? values : values[0];
}
