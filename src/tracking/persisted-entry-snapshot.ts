import type { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import {
    captureNavigationSnapshotValues,
    type NavigationSnapshotValues,
} from './navigation-snapshot';

/** Exact tracked state represented by one executable save plan. */
export interface PersistedEntrySnapshot {
    readonly entry: EntityEntry<object>;
    readonly state: EntityState;
    readonly values: Record<string, unknown>;
    readonly navigations: NavigationSnapshotValues;
}

export function capturePersistedEntrySnapshot(
    entry: EntityEntry<object>,
): PersistedEntrySnapshot {
    return {
        entry,
        state: entry.state,
        values: entry.currentValues(),
        navigations: captureNavigationSnapshotValues(entry),
    };
}
