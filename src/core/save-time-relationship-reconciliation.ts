import type { ChangeTracker } from '../tracking/change-tracker';
import { captureNavigationSnapshotValues } from '../tracking/navigation-snapshot';
import type { SaveTimeMutationLog } from './save-time-mutations';

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
): void {
    const before = captureLiveNavigations(tracker);
    tracker.detectSaveRelationships();
    for (const previous of before) {
        const applied = cloneNavigationValue(
            previous.entity[previous.property],
        );
        if (navigationValuesEqual(previous.snapshot, applied)) continue;
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
}

function captureLiveNavigations(
    tracker: ChangeTracker,
): NavigationValue[] {
    return tracker.entries().flatMap(entry => {
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
