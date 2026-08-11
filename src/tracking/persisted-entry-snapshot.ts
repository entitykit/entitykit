import type { EntityEntry } from './entity-entry';
import {
    captureCurrentNavigationSnapshotValues,
    captureNavigationSnapshotValues,
    type NavigationSnapshotValues,
} from './navigation-snapshot';
import {
    readPropertyPath,
    readPropertyValue,
} from '../model/property-value-access';
import type { EntityState } from './entity-state';
import {
    captureMissingBoundEntityValues,
    cloneBoundValues,
} from './bound-value-snapshot';
import { snapshotValuesEqual } from './snapshot-value-equality';
import { snapshotPropertyValueCopies } from './snapshot-value';
import { toBoundProviderValue } from '../model/value-converter/store-value';
import { cloneSnapshotValue } from './snapshot-value-clone';

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
    const snapshot = capturePersistedEntrySnapshotFromValues(
        entry,
        entry.state,
        entry.currentValues(),
    );
    captureMissingBoundEntityValues(
        entry.metadata,
        snapshot.values,
        snapshot.boundValues,
    );
    return snapshot;
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
        originalBoundValues: cloneBoundValues(entry.originalBoundValues),
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

/** Refresh graph facts changed by final save-time relationship fix-up. */
export function refreshPersistedEntryRelationships(
    snapshot: PersistedEntrySnapshot,
): PersistedEntrySnapshot {
    const { entry } = snapshot;
    const foreignKeys = new Set(entry.metadata.relationships.flatMap(
        relationship => relationship.foreignKeyProperties as readonly string[],
    ));
    for (const propertyName of foreignKeys) {
        const property = entry.metadata.getProperty(propertyName);
        const liveValue = readPropertyValue(entry.entity, property);
        if (snapshotValuesEqual(liveValue, snapshot.values[propertyName])) {
            continue;
        }
        const context = `${entry.metadata.entityName}.${propertyName}`;
        const copies = snapshotPropertyValueCopies(
            liveValue,
            property.converter,
            context,
        );
        snapshot.values[propertyName] = copies.persistedValue;
        snapshot.boundValues[propertyName] = cloneSnapshotValue(
            toBoundProviderValue(
                copies.providerValue,
                property.columnType,
                context,
            ),
        );
    }
    return {
        ...snapshot,
        state: entry.state,
        relationshipValues: Object.fromEntries(
            entry.metadata.relationships.map(relationship => [
                String(relationship.navigationProperty),
                (entry.entity as Record<string, unknown>)[
                    relationship.navigationProperty
                ],
            ]),
        ),
        navigations: captureCurrentNavigationSnapshotValues(entry),
    };
}
