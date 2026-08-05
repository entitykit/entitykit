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
    readonly relationshipValues: Readonly<Record<string, unknown>>;
    readonly complexPropertyValues: Readonly<Record<string, unknown>>;
    readonly navigations: NavigationSnapshotValues;
}

export function capturePersistedEntrySnapshot(
    entry: EntityEntry<object>,
): PersistedEntrySnapshot {
    const values = entry.currentValues();
    const state = entry.setStateFromCapturedValues(values);
    return {
        entry,
        state,
        values,
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
