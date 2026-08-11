import { readPropertyValue } from '../model/property-value-access';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { captureNavigationSnapshotValues } from '../tracking/navigation-snapshot';
import { snapshotPropertyValuesEqual } from '../tracking/snapshot-value';

export interface NavigationCheckpoint {
    readonly property: string;
    readonly value: unknown;
    readonly snapshot: unknown;
}

export function captureGenerationForeignKeys(
    snapshot: PersistedEntrySnapshot,
): ReadonlyMap<string, unknown> {
    const properties = new Set(snapshot.entry.metadata.relationships.flatMap(
        relationship => relationship.foreignKeyProperties.map(String),
    ));
    return new Map([...properties].map(property => [
        property, snapshot.values[property],
    ]));
}

export function captureGenerationNavigations(
    snapshot: PersistedEntrySnapshot,
): readonly NavigationCheckpoint[] {
    const entity = snapshot.entry.entity as Record<string, unknown>;
    return [...captureNavigationSnapshotValues(snapshot.entry).keys()].map(
        property => ({
            property,
            value: entity[property],
            snapshot: cloneNavigationValue(entity[property]),
        }),
    );
}

export function generationForeignKeyWasEdited(
    snapshot: PersistedEntrySnapshot,
    applied: ReadonlyMap<string, unknown>,
): boolean {
    return [...applied].some(([propertyName, value]) => {
        const property = snapshot.entry.metadata.getProperty(propertyName);
        return !snapshotPropertyValuesEqual(
            readPropertyValue(snapshot.entry.entity, property),
            value,
            property.converter,
            `${snapshot.entry.metadata.entityName}.${propertyName}`,
        );
    });
}

export function restoreGenerationNavigation(
    entity: Record<string, unknown>,
    previous: NavigationCheckpoint,
): void {
    if (isUnknownArray(previous.value) && isUnknownArray(previous.snapshot)) {
        previous.value.splice(0, previous.value.length, ...previous.snapshot);
    }
    entity[previous.property] = previous.value;
}

export function cloneNavigationValue(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
