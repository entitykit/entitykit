import type { EntityEntry } from './entity-entry';
import {
    captureNavigation,
    captureNavigationSnapshotValues,
    navigationValueChanged,
} from './navigation-snapshot';

interface NavigationCheckpoint {
    readonly entry: EntityEntry<object>;
    readonly property: string;
    readonly value: unknown;
}

/** Advance baselines only for navigation values changed by framework fix-up. */
export function captureRelationshipFixupBaseline(
    entries: ReadonlyArray<EntityEntry<object>>,
): () => void {
    const checkpoints: NavigationCheckpoint[] = entries.flatMap(entry => {
        const entity = entry.entity as Record<string, unknown>;
        return [...captureNavigationSnapshotValues(entry).keys()].map(
            property => ({
                entry,
                property,
                value: cloneNavigationValue(entity[property]),
            }),
        );
    });
    return () => {
        for (const checkpoint of checkpoints) {
            const current = (checkpoint.entry.entity as Record<string, unknown>)[
                checkpoint.property
            ];
            if (navigationValueChanged(checkpoint.value, current)) {
                captureNavigation(checkpoint.entry, checkpoint.property);
            }
        }
    };
}

function cloneNavigationValue(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
