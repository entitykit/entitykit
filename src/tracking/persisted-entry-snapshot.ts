import type { EntityEntry } from './entity-entry';
import {
    captureNavigationSnapshotValues,
    type NavigationSnapshotValues,
} from './navigation-snapshot';
import { readPropertyPath } from '../model/property-value-access';
import { hasEntityValueModifications } from './entity-entry-snapshot';
import { EntityState } from './entity-state';

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
    if (
        entry.state === EntityState.Unchanged ||
        entry.state === EntityState.Modified
    ) {
        entry.state = hasEntityValueModifications(
            entry.metadata,
            values,
            entry.originalValues,
        )
            ? EntityState.Modified
            : EntityState.Unchanged;
    }
    return {
        entry,
        state: entry.state,
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
