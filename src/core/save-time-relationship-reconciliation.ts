import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityEntry } from '../tracking/entity-entry';
import { captureNavigationSnapshotValues } from '../tracking/navigation-snapshot';
import type { SaveTimeMutationLog } from './save-time-mutations';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';

export function rememberSaveTimeRelationshipWrites(
    target: Map<object, Set<string>>,
    snapshot: PersistedEntrySnapshot,
    tenantWritten: boolean,
): void {
    const policyWrites = new Set(Object.keys(snapshot.boundValues));
    const tenantProperty = snapshot.entry.metadata.tenantKeyProperty as
        string | undefined;
    if (tenantWritten && tenantProperty) policyWrites.add(tenantProperty);
    const relationshipWrites = new Set(snapshot.entry.metadata.relationships.flatMap(
        relationship => relationship.foreignKeyProperties.filter(property =>
            policyWrites.has(String(property))).map(String),
    ));
    if (relationshipWrites.size > 0) {
        target.set(snapshot.entry.entity, relationshipWrites);
    }
}

interface NavigationValue {
    readonly entity: Record<string, unknown>;
    readonly property: string;
    readonly value: unknown;
    readonly snapshot: unknown;
}

/** Re-run graph fix-up after audit and other final policy FK writes. */
export function reconcileSaveTimeRelationships(
    tracker: ChangeTracker,
    mutations: SaveTimeMutationLog,
    entries: ReadonlyArray<EntityEntry<object>>,
): ReadonlyMap<object, ReadonlySet<string>> {
    if (entries.length === 0) return new Map();
    const before = captureLiveNavigations(tracker.entries());
    const changed: Map<object, Set<string>> = new Map();
    tracker.detectSaveRelationships(entries, undefined, false);
    for (const previous of before) {
        const applied = cloneNavigationValue(
            previous.entity[previous.property],
        );
        if (navigationValuesEqual(previous.snapshot, applied)) continue;
        const properties = changed.get(previous.entity) ?? new Set<string>();
        properties.add(previous.property);
        changed.set(previous.entity, properties);
        mutations.recordRestoration(() => {
            const current = previous.entity[previous.property];
            if (!navigationValuesEqual(current, applied)) return;
            if (Array.isArray(previous.value)) {
                previous.value.splice(
                    0,
                    previous.value.length,
                    ...previous.snapshot as unknown[],
                );
            }
            previous.entity[previous.property] = previous.value;
        });
    }
    return changed;
}

function captureLiveNavigations(
    entries: ReadonlyArray<EntityEntry<object>>,
): NavigationValue[] {
    return entries.flatMap(entry => {
        const entity = entry.entity as Record<string, unknown>;
        return [...captureNavigationSnapshotValues(entry).keys()].map(
            property => {
                const value = entity[property];
                return {
                    entity,
                    property,
                    value,
                    snapshot: cloneNavigationValue(value),
                };
            },
        );
    });
}

function cloneNavigationValue(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

function navigationValuesEqual(left: unknown, right: unknown): boolean {
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length &&
            left.every((value, index) => value === right[index]);
    }
    return left === right;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
