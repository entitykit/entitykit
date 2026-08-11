import type { Model } from '../model/model';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export interface NavigationSnapshot {
    readonly known: boolean;
    readonly value: unknown;
}

export type NavigationSnapshotValues = ReadonlyMap<string, unknown>;

const snapshots: WeakMap<
    EntityEntry<object>,
    Map<string, unknown>
> = new WeakMap();

/** Capture every reference and inverse navigation declared for this entity. */
export function initializeNavigationSnapshots(
    entry: EntityEntry<object>,
    model: Model,
): void {
    const properties: Set<string> = new Set(
        entry.metadata.relationships.map(relationship =>
            String(relationship.navigationProperty)),
    );
    for (const dependent of model.entities) {
        const relationships = dependent.relationships as
            readonly TrackedRelationshipMetadata[];
        for (const relationship of relationships) {
            if (
                relationship.principalEntity === entry.metadata.ctor &&
                relationship.inverseNavigationProperty
            ) {
                properties.add(relationship.inverseNavigationProperty);
            }
        }
    }
    for (const property of properties) {
        captureNavigation(entry, property);
    }
}

export function captureNavigation(
    entry: EntityEntry<object>,
    property: string,
): void {
    const values = snapshots.get(entry) ?? new Map<string, unknown>();
    const current = (entry.entity as Record<string, unknown>)[property];
    values.set(property, cloneNavigationValue(current));
    snapshots.set(entry, values);
}

export function forgetNavigation(
    entry: EntityEntry<object>,
    property: string,
): void {
    snapshots.get(entry)?.delete(property);
}

export function navigationSnapshot(
    entry: EntityEntry<object>,
    property: string,
): NavigationSnapshot {
    const values = snapshots.get(entry);
    return {
        known: values?.has(property) ?? false,
        value: values?.get(property),
    };
}

export function refreshNavigationSnapshots(entry: EntityEntry<object>): void {
    const values = snapshots.get(entry);
    if (!values) {
        return;
    }
    for (const property of values.keys()) {
        const current = (entry.entity as Record<string, unknown>)[property];
        values.set(property, cloneNavigationValue(current));
    }
}

/** Copy the relationship baseline represented by a pending save plan. */
export function captureNavigationSnapshotValues(
    entry: EntityEntry<object>,
): NavigationSnapshotValues {
    const values = snapshots.get(entry);
    return new Map(
        Array.from(values?.entries() ?? []).map(([property, value]) => [
            property,
            cloneNavigationValue(value),
        ]),
    );
}

/** Capture the live graph after save-time relationship reconciliation. */
export function captureCurrentNavigationSnapshotValues(
    entry: EntityEntry<object>,
): NavigationSnapshotValues {
    const properties = snapshots.get(entry)?.keys() ?? [];
    const entity = entry.entity as Record<string, unknown>;
    return new Map(Array.from(properties, property => [
        property,
        cloneNavigationValue(entity[property]),
    ]));
}

/** Accept an exact relationship baseline without observing later mutations. */
export function acceptNavigationSnapshotValues(
    entry: EntityEntry<object>,
    accepted: NavigationSnapshotValues,
): void {
    snapshots.set(
        entry,
        new Map(
            [...accepted.entries()].map(([property, value]) => [
                property,
                cloneNavigationValue(value),
            ]),
        ),
    );
}

export function navigationValueChanged(
    previous: unknown,
    current: unknown,
): boolean {
    if (Array.isArray(previous) && Array.isArray(current)) {
        return previous.length !== current.length ||
            previous.some((value, index) => value !== current[index]);
    }
    return previous !== current;
}

function cloneNavigationValue(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
